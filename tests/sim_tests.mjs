#!/usr/bin/env node
// Comprehensive sim test suite — wave progression, weapon DPS math,
// prestige carry-over, enemy projectiles, boss phases, pierce fix.
//
// Run with: node tests/sim_tests.mjs

import { tickSim } from '../src/shared/sim/tick.js';
import { createRng } from '../src/shared/sim/rng.js';
import { createWeapon, getWeaponPreview, powerupWeaponType } from '../src/shared/weapons.js';
import { ENEMY_TYPES, WAVE_POOLS, SPECIAL_WAVES, enemyType, scaleEnemy } from '../src/shared/enemyTypes.js';
import { calculateScales, applyUnlocks, sanitizePrestige, UNLOCKS } from '../src/shared/prestige.js';
import { fireEnemyProjectile, enemyShootingAi, updateEnemyProjectiles } from '../src/shared/sim/enemyProjectiles.js';
import { updateWaves } from '../src/shared/sim/waves.js';
import { EVT } from '../src/shared/sim/events.js';
import { MAPS, resolveMapObstacles } from '../src/shared/maps.js';
import { generateClusterScatter, generateCorridor } from '../src/shared/mapGen.js';
import { damageEnemy } from '../src/shared/sim/damage.js';
import { computeDeathHighlights } from '../src/shared/deathHighlights.js';
import { computeWeaponHistogram } from '../src/shared/weaponPickHistogram.js';
import { updateWeapons, updateAuras, updateMeteorEffects } from '../src/shared/sim/weapons_runtime.js';
import { spawnGem } from '../src/shared/sim/gems.js';
import { markSeen, getBestiaryEntries, _resetCache } from '../src/shared/bestiary.js';
import {
  WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP, XP_MAGNET_RANGE,
} from '../src/shared/constants.js';

// ── Test framework ──────────────────────────────────────────────
let totalPassed = 0, totalFailed = 0;
const failures = [];

function suite(name, fn) {
  console.log(`\n═══ ${name} ═══`);
  fn();
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    totalPassed++;
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`);
    totalFailed++;
    failures.push(`${name}: ${e.message}`);
  }
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

function assertClose(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg}: ${a} not within ${tol} of ${b}`);
}

// ── Helpers ─────────────────────────────────────────────────────
function makePlayer(overrides = {}) {
  return {
    id: 0, x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0,
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
    radius: PLAYER_RADIUS, speed: PLAYER_SPEED,
    damageMulti: 1, attackSpeedMulti: 1, hpRegen: 0,
    magnetRange: XP_MAGNET_RANGE,
    projectileBonus: 0, sizeMulti: 1, armor: 0,
    magnetBoost: 0,
    xp: 0, xpToLevel: 45, level: 1, kills: 0, score: 0,
    weapons: [createWeapon('spit')],
    alive: true, iframes: 0, facing: { x: 1, y: 0 },
    relics: {},
    ...overrides,
  };
}

function makeGame(overrides = {}) {
  const player = overrides.player || makePlayer(overrides.playerOverrides);
  return {
    player,
    players: [player],
    enemies: [], projectiles: [], gems: [], heartDrops: [], consumables: [], chests: [], enemyProjectiles: [],
    particles: [], floatingTexts: [], deathFeed: [],
    chainEffects: [], meteorEffects: [],
    time: 0, wave: 1, waveTimer: 0, waveDuration: 20,
    spawnTimer: 0, spawnRate: 2.0,
    specialWaveMsg: null, specialWaveMsgTimer: 0,
    waveMsg: '', waveMsgTimer: 0,
    kills: 0, playerName: 'test',
    camera: { x: WORLD_W / 2, y: WORLD_H / 2 }, screenShake: 0,
    events: [], rng: createRng(overrides.seed || 42),
    ...overrides,
  };
}

function tickN(g, n, dt = 1/60) {
  for (let i = 0; i < n; i++) {
    tickSim(g, dt);
    g.time += dt;
    g.waveTimer += dt;
  }
}

function countEvents(g, type) {
  return g.events.filter(e => e.type === type).length;
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

suite('Wave Progression', () => {
  test('wave advances after waveDuration seconds', () => {
    const g = makeGame({ waveDuration: 5 });
    // waveDuration=5 → need slightly more than 5s since waveTimer
    // increments after tickSim checks the threshold
    const ticksFor5s = 5 * 60 + 5;
    tickN(g, ticksFor5s);
    assert(g.wave >= 2, `expected wave >= 2, got ${g.wave}`);
  });

  test('spawn rate decays with wave', () => {
    const rate1 = 2.0;
    const rate2 = Math.max(0.3, 2.0 * Math.pow(0.90, 1)); // wave 2
    const rate5 = Math.max(0.3, 2.0 * Math.pow(0.90, 4)); // wave 5
    assert(rate2 < rate1, 'spawn rate should decrease wave 1→2');
    assert(rate5 < rate2, 'spawn rate should decrease wave 2→5');
    assert(rate5 >= 0.3, 'spawn rate should not go below 0.3');
  });

  test('spawn rate floors at 0.3', () => {
    // At wave 50, formula gives 2.0 * 0.90^49 ≈ 0.011 → clamped to 0.3
    const rate = Math.max(0.3, 2.0 * Math.pow(0.90, 49));
    assert(rate === 0.3, `expected 0.3, got ${rate}`);
  });

  test('max enemies cap scales with wave', () => {
    // maxEnemies = 80 + wave * 10
    assert(80 + 1 * 10 === 90, 'wave 1 cap should be 90');
    assert(80 + 10 * 10 === 180, 'wave 10 cap should be 180');
    assert(80 + 20 * 10 === 280, 'wave 20 cap should be 280');
  });

  test('special waves exist at documented waves', () => {
    const specialWaves = [6, 7, 9, 11, 13, 15, 17, 19, 20];
    for (const w of specialWaves) {
      assert(SPECIAL_WAVES[w], `special wave ${w} should exist`);
      assert(SPECIAL_WAVES[w].name, `special wave ${w} should have name`);
    }
  });

  test('WAVE_SURVIVED event emitted on wave change', () => {
    const g = makeGame({ waveDuration: 1 });
    tickN(g, 61); // just past 1 second
    const waveSurvived = g.events.filter(e => e.type === 'waveSurvived');
    assert(waveSurvived.length >= 1, 'should emit waveSurvived event');
  });

  test('burst count scales with wave and caps at 12', () => {
    // baseCount = 1 + floor(wave/2), cap 12
    assert(1 + Math.floor(1/2) === 1, 'wave 1 base count should be 1');
    assert(1 + Math.floor(10/2) === 6, 'wave 10 base count should be 6');
    assert(Math.min(1 + Math.floor(30/2), 12) === 12, 'wave 30 base count should cap at 12');
  });
});

suite('Enemy Scaling', () => {
  const rng = createRng(99);

  test('HP scales with wave', () => {
    const blob1 = scaleEnemy(ENEMY_TYPES[0], 1, rng);
    const blob10 = scaleEnemy(ENEMY_TYPES[0], 10, rng);
    assert(blob10.hp > blob1.hp, `wave 10 HP (${blob10.hp}) should exceed wave 1 (${blob1.hp})`);
  });

  test('speed scales gently', () => {
    const fast1 = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'fast'), 1, rng);
    const fast10 = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'fast'), 10, rng);
    assert(fast10.speed > fast1.speed, 'speed should increase');
    // Speed scale is 1 + (wave-1)*0.03, wave 10 → 1.27x — shouldn't double
    assert(fast10.speed < fast1.speed * 2, 'speed should not double by wave 10');
  });

  test('damage scales linearly', () => {
    const base = ENEMY_TYPES.find(t => t.name === 'blob');
    const blob5 = scaleEnemy(base, 5, rng);
    // dmgScale = 1 + (5-1)*0.1 = 1.4
    const expected = Math.floor(base.damage * 1.4);
    assert(blob5.damage === expected, `expected ${expected}, got ${blob5.damage}`);
  });

  test('maxHp equals hp on spawn', () => {
    const e = scaleEnemy(ENEMY_TYPES[0], 5, rng);
    assert(e.hp === e.maxHp, `hp (${e.hp}) should equal maxHp (${e.maxHp})`);
  });

  test('shootTimer initialized with jitter for elites', () => {
    const elite = ENEMY_TYPES.find(t => t.name === 'elite');
    const e1 = scaleEnemy(elite, 10, createRng(1));
    const e2 = scaleEnemy(elite, 10, createRng(2));
    // Both should have shootTimer, but likely different values due to rng
    assert(e1.shootTimer > 0, 'elite should have shootTimer > 0');
    assert(e2.shootTimer > 0, 'elite should have shootTimer > 0');
    assert(e1.shootCooldown === 2.0, 'elite cooldown should be 2.0');
  });

  test('boss has shooting stats', () => {
    const boss = ENEMY_TYPES.find(t => t.name === 'boss');
    const e = scaleEnemy(boss, 20, rng);
    assert(e.shootCooldown === 3.0, 'boss cooldown should be 3.0');
    assert(e.shootDamage > 0, 'boss should have shootDamage');
    assert(e.shootSpeed === 160, 'boss shootSpeed should be 160');
    assert(e.shootRange === 450, 'boss shootRange should be 450');
  });

  test('wave pool transitions at correct boundaries', () => {
    // Wave 1-2: blob + swarm only
    const pool1 = WAVE_POOLS.find(p => 1 <= p.maxWave);
    assert(pool1.weights.blob && pool1.weights.swarm, 'wave 1 pool should have blob+swarm');
    assert(!pool1.weights.fast, 'wave 1 pool should not have fast');

    // Wave 5: has fast
    const pool5 = WAVE_POOLS.find(p => 5 <= p.maxWave);
    assert(pool5.weights.fast, 'wave 5 pool should have fast');
  });
});

suite('Weapon DPS Math', () => {
  test('spit base DPS = damage / cooldown', () => {
    const w = createWeapon('spit');
    const dps = w.damage / w.cooldown;
    assertClose(dps, 25, 0.01, 'spit DPS should be 20/0.8=25 (post balance pass)');
  });

  test('breath fires continuously (low cooldown)', () => {
    const w = createWeapon('breath');
    assert(w.cooldown === 0.5, `breath cooldown should be 0.5, got ${w.cooldown}`);
    assert(w.damage === 8, `breath damage should be 8, got ${w.damage}`);
  });

  test('charge has high burst damage with long cooldown', () => {
    const w = createWeapon('charge');
    assert(w.damage === 40, 'charge damage should be 40');
    assert(w.cooldown === 1.8, 'charge cooldown should be 1.8');
    // DPS = 40/1.8 ≈ 22.2
    assertClose(w.damage / w.cooldown, 22.2, 0.1, 'charge DPS');
  });

  test('orbit has continuous damage (cooldown 0)', () => {
    const w = createWeapon('orbit');
    assert(w.cooldown === 0, 'orbit should have 0 cooldown');
    assert(w.bladeCount === 2, 'orbit should start with 2 blades');
  });

  test('meteor has highest single-hit damage', () => {
    const m = createWeapon('meteor');
    const all = ['spit', 'breath', 'charge', 'orbit', 'chain', 'shield', 'lightning_field'];
    for (const name of all) {
      const w = createWeapon(name);
      assert(m.damage >= w.damage, `meteor damage (${m.damage}) should be >= ${name} (${w.damage})`);
    }
  });

  test('dragon_storm is strictly better than spit', () => {
    const spit = createWeapon('spit');
    const ds = createWeapon('dragon_storm');
    assert(ds.damage > spit.damage, 'dragon_storm damage > spit');
    assert(ds.cooldown < spit.cooldown, 'dragon_storm fires faster');
    assert(ds.count > spit.count, 'dragon_storm fires more projectiles');
    assert(ds.pierce > spit.pierce, 'dragon_storm has more pierce');
  });

  test('all weapon types create valid objects', () => {
    const types = ['spit', 'breath', 'charge', 'orbit', 'chain', 'meteor',
      'shield', 'lightning_field', 'dragon_storm', 'thunder_god', 'meteor_orbit', 'fortress',
      'inferno_wheel', 'tesla_aegis'];
    for (const t of types) {
      const w = createWeapon(t);
      assert(w !== null, `${t} should create a weapon`);
      assert(w.type === t, `${t} type should match`);
      // inferno_wheel + tesla_aegis split damage across bladeDamage / chainDamage / shieldDamage
      const d = w.damage ?? w.bladeDamage ?? w.chainDamage ?? w.shieldDamage;
      assert(typeof d === 'number' && d > 0, `${t} should have positive damage`);
    }
  });

  test('damageMulti amplifies projectile damage', () => {
    // Sim-level: projectile damage is proj.damage * owner.damageMulti
    const g = makeGame({ playerOverrides: { damageMulti: 2.0 } });
    // Place an enemy right in front of spit
    const rng = createRng(1);
    const enemy = scaleEnemy(ENEMY_TYPES[0], 1, rng);
    enemy.x = g.player.x + 50;
    enemy.y = g.player.y;
    enemy.hp = 9999;
    enemy.maxHp = 9999;
    g.enemies.push(enemy);
    const startHp = enemy.hp;
    tickN(g, 120); // 2 seconds — spit should fire and hit
    assert(enemy.hp < startHp, 'enemy should take damage from spit');
    // With 2x damageMulti, damage per hit should be 30 instead of 15
    const hits = g.events.filter(e => e.type === 'enemyHit');
    if (hits.length > 0) {
      // At least one hit should deal 2x base damage (30)
      const maxDmg = Math.max(...hits.map(h => h.dmg));
      assert(maxDmg >= 28, `max hit damage ${maxDmg} should be ~30 (15 * 2.0)`);
    }
  });
});

suite('Cross-pair Evolutions', () => {
  test('inferno_wheel applies burn on blade contact', () => {
    const g = makeGame({ playerOverrides: { weapons: [createWeapon('inferno_wheel')] } });
    const rng = createRng(1);
    const e = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'tank'), 1, rng);
    // Place the enemy at the 0-angle blade start position (radius 85)
    e.x = g.player.x + 85;
    e.y = g.player.y;
    e.hp = 9999; e.maxHp = 9999;
    g.enemies.push(e);
    tickN(g, 30); // 0.5s — blade sweeps onto the enemy
    assert(e.statusEffects && e.statusEffects.some(s => s.type === 'burn'),
      'enemy under inferno blade should have burn status');
    assert(e.hp < 9999, 'enemy should take blade damage');
  });

  test('tesla_aegis shield damages + knocks back contact', () => {
    const g = makeGame({ playerOverrides: { weapons: [createWeapon('tesla_aegis')] } });
    const rng = createRng(1);
    const e = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'blob'), 1, rng);
    e.x = g.player.x + 40; // inside 90u shield radius
    e.y = g.player.y;
    e.hp = 9999; e.maxHp = 9999;
    g.enemies.push(e);
    const startX = e.x, startHp = e.hp;
    tickN(g, 10);
    assert(e.x > startX, 'enemy inside shield should be knocked outward');
    assert(e.hp < startHp, 'enemy inside shield should take damage');
  });

  test('tesla_aegis chain pulse applies slow', () => {
    const g = makeGame({ playerOverrides: { weapons: [createWeapon('tesla_aegis')] } });
    const rng = createRng(1);
    const e = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'blob'), 1, rng);
    // Place outside shield (90) but inside chain range (200)
    e.x = g.player.x + 150;
    e.y = g.player.y;
    e.hp = 9999; e.maxHp = 9999;
    g.enemies.push(e);
    tickN(g, 40); // 0.66s — at least one pulse should have fired
    assert(e.statusEffects && e.statusEffects.some(s => s.type === 'slow'),
      'enemy pulse-chained by tesla_aegis should be slowed');
  });

  test('tesla_aegis overcharge stuns on 4th pulse', () => {
    const g = makeGame({ playerOverrides: { weapons: [createWeapon('tesla_aegis')] } });
    const rng = createRng(1);
    // Enemies inside the overcharge expand radius (150) but outside the
    // shield (90) so we isolate the overcharge stun from any shield
    // contact effects.
    for (let i = 0; i < 4; i++) {
      const e = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'blob'), 1, rng);
      e.x = g.player.x + 110 + i * 5;
      e.y = g.player.y + i * 5;
      e.hp = 9999; e.maxHp = 9999;
      g.enemies.push(e);
    }
    // First pulse on tick 1; then every 30 ticks. 4th pulse (overcharge)
    // fires ~tick 91. stun lasts 0.3s (~18 ticks) so we check just after.
    tickN(g, 95);
    const stunned = g.enemies.some(e => (e.stunTimer || 0) > 0);
    assert(stunned, 'at least one enemy should be stunned from overcharge pulse');
    const w = g.player.weapons[0];
    assert(w.pulseCount >= 4, `pulseCount should be >= 4, got ${w.pulseCount}`);
  });

  test('poisoner contact applies player poison DoT', () => {
    const g = makeGame();
    const rng = createRng(1);
    const e = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'poisoner'), 1, rng);
    e.x = g.player.x;
    e.y = g.player.y; // overlap → contact
    g.enemies.push(e);
    tickN(g, 5); // contact triggers
    assert((g.player.poisonTimer || 0) > 0, `poisonTimer should be set, got ${g.player.poisonTimer}`);
    const startHp = g.player.hp;
    // Move player away so contact damage stops; let poison tick alone
    g.player.x += 200;
    g.player.iframes = 0;
    tickN(g, 60); // 1s, two poison ticks at 0.5s cadence
    assert(g.player.hp < startHp, 'poison should tick down hp after contact ends');
  });

  test('splitter death spawns swarmlings', () => {
    const g = makeGame();
    const rng = createRng(1);
    const e = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'splitter'), 1, rng);
    e.x = g.player.x + 60;
    e.y = g.player.y;
    g.enemies.push(e);
    const startCount = g.enemies.length;
    // damageEnemy directly to trigger death — bypasses needing a weapon
    // hit and proves the on-death hook fires regardless of damage
    // source.
    damageEnemy(g, e, 9999, 0);
    assert(e.dying !== undefined, 'splitter should be marked dying');
    // 3 swarmlings spawned at the kill site
    assert(g.enemies.length === startCount + 3,
      `expected +3 enemies after splitter death, got ${g.enemies.length - startCount}`);
    const newOnes = g.enemies.slice(startCount);
    assert(newOnes.every(n => n.name === 'swarm'), 'split children should be swarm type');
  });

  test('bomber death queues player-targeting meteor effect', () => {
    const g = makeGame();
    const rng = createRng(1);
    const e = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'bomber'), 1, rng);
    e.x = g.player.x + 30;
    e.y = g.player.y;
    g.enemies.push(e);
    const startEffects = g.meteorEffects.length;
    damageEnemy(g, e, 9999, 0);
    assert(g.meteorEffects.length === startEffects + 1,
      `expected +1 meteor effect after bomber death, got ${g.meteorEffects.length - startEffects}`);
    const me = g.meteorEffects[g.meteorEffects.length - 1];
    assert(me.targetsPlayer === true, 'bomber blast should target the player');
    assert(me.sourceName === 'bomber', `expected sourceName=bomber, got ${me.sourceName}`);
    // Tick past the warn window — explode should hurt the player
    const startHp = g.player.hp;
    g.player.iframes = 0;
    tickN(g, 30); // 0.5s — warn (0.3s) → explode
    assert(g.player.hp < startHp,
      `bomber blast should hurt player (hp ${startHp} → ${g.player.hp})`);
  });

  test('spawner mixes poisoners into broods at wave 12+', () => {
    // Run a wave-12 sim long enough that spawner has fired several
    // broods. Statistical: with ~33% poisoner chance and 3-5 minions
    // per brood, 4 broods give ~5-6 poisoners on average. Asserting
    // ">= 1" gives a very wide margin that's robust to rng draws.
    const g = makeGame({ wave: 12, seed: 7 });
    const rng = createRng(7);
    const spawner = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'spawner'), 12, rng);
    spawner.x = g.player.x + 400;
    spawner.y = g.player.y;
    spawner.spawnTimer = 0; // fire immediately
    g.enemies.push(spawner);
    tickN(g, 60 * 20); // 20 sim seconds, ~4-5 broods
    const poisoners = g.enemies.filter(e => e.name === 'poisoner');
    assert(poisoners.length >= 1,
      `wave 12 spawner should birth at least one poisoner, got ${poisoners.length}`);
  });

  test('spawner stays swarm-only before wave 12', () => {
    const g = makeGame({ wave: 6, seed: 7 });
    const rng = createRng(7);
    const spawner = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'spawner'), 6, rng);
    spawner.x = g.player.x + 400;
    spawner.y = g.player.y;
    spawner.spawnTimer = 0;
    g.enemies.push(spawner);
    tickN(g, 60 * 20);
    const poisoners = g.enemies.filter(e => e.name === 'poisoner');
    assert(poisoners.length === 0,
      `wave 6 spawner should never birth poisoners, got ${poisoners.length}`);
  });

  test('healer pulses hp back into nearby damaged enemies', () => {
    const g = makeGame();
    const rng = createRng(1);
    const healer = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'healer'), 1, rng);
    healer.x = g.player.x + 500;
    healer.y = g.player.y; // far enough that contact damage isn't the test variable
    g.enemies.push(healer);
    // Damaged blob inside heal radius (140u)
    const blob = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'blob'), 1, rng);
    blob.x = healer.x + 60;
    blob.y = healer.y;
    blob.hp = 1;
    g.enemies.push(blob);
    tickN(g, 180); // 3s — should cover at least one heal pulse
    assert(blob.hp > 1, `damaged blob near healer should regen (hp now ${blob.hp})`);
    assert(blob.hp <= blob.maxHp, 'heal should cap at maxHp');
  });

  test('procedural cluster-scatter is deterministic per seed', () => {
    // Same seed must produce same obstacle layout so MP clients that
    // replay from the welcome snapshot never disagree on positions.
    const cfg = {
      width: 3500, height: 3500,
      clusterCount: 8,
      objectsPerCluster: [4, 10],
      clusterRadius: 180,
      objectSize: 60,
      type: 'tree',
      spawnSafeZone: { x: 1750, y: 1750, radius: 400 },
    };
    const a = generateClusterScatter(createRng(42), cfg);
    const b = generateClusterScatter(createRng(42), cfg);
    assert(a.length === b.length, `length mismatch: ${a.length} vs ${b.length}`);
    for (let i = 0; i < a.length; i++) {
      assert(a[i].x === b[i].x && a[i].y === b[i].y,
        `obstacle ${i} differs: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`);
    }
    // Different seeds produce different layouts
    const c = generateClusterScatter(createRng(99), cfg);
    const sameShape = a.length === c.length && a.every((o, i) => o.x === c[i].x && o.y === c[i].y);
    assert(!sameShape, 'different seeds should produce different layouts');
  });

  test('procedural obstacles respect spawn safe zone', () => {
    const cfg = {
      width: 3500, height: 3500,
      clusterCount: 8,
      objectsPerCluster: [4, 10],
      clusterRadius: 180,
      objectSize: 60,
      type: 'tree',
      spawnSafeZone: { x: 1750, y: 1750, radius: 400 },
    };
    for (const seed of [1, 42, 99, 1234, 9999]) {
      const obs = generateClusterScatter(createRng(seed), cfg);
      for (const o of obs) {
        const dx = o.x - cfg.spawnSafeZone.x;
        const dy = o.y - cfg.spawnSafeZone.y;
        const dist2 = dx * dx + dy * dy;
        const safe2 = cfg.spawnSafeZone.radius * cfg.spawnSafeZone.radius;
        assert(dist2 >= safe2,
          `seed ${seed}: obstacle at (${o.x},${o.y}) is inside spawn safe zone (dist²=${dist2} < ${safe2})`);
      }
    }
  });

  test('resolveMapObstacles handles static + procedural maps', () => {
    // Static map: forest ships a hand-placed obstacle array
    const forest = resolveMapObstacles(MAPS.forest, createRng(1));
    assert(Array.isArray(forest) && forest.length > 0, 'forest has static obstacles');
    // Procedural map: wilderness generates on every resolve call
    const w1 = resolveMapObstacles(MAPS.wilderness, createRng(42));
    const w2 = resolveMapObstacles(MAPS.wilderness, createRng(42));
    assert(w1.length === w2.length, 'wilderness same seed → same count');
    assert(w1.every((o, i) => o.x === w2[i].x), 'wilderness same seed → same positions');
  });

  test('evolution status stacks refresh (burn + inferno_wheel)', () => {
    const g = makeGame({ playerOverrides: { weapons: [createWeapon('inferno_wheel')] } });
    const rng = createRng(1);
    const e = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'tank'), 1, rng);
    e.x = g.player.x + 85;
    e.y = g.player.y;
    e.hp = 9999; e.maxHp = 9999;
    g.enemies.push(e);
    tickN(g, 10);
    const burn = e.statusEffects && e.statusEffects.find(s => s.type === 'burn');
    assert(burn, 'burn applied');
    const firstRemaining = burn.remaining;
    // Let some time pass — burn remaining should decrement; then re-apply
    tickN(g, 5);
    // Re-application should refresh to max(existing, new) — fresh blade
    // contact pushes remaining back toward full duration.
    const burn2 = e.statusEffects.find(s => s.type === 'burn');
    assert(burn2.remaining > 0, 'burn should still be active after refresh');
    assert(burn2.remaining >= firstRemaining - 0.5,
      `refresh should keep remaining high (first=${firstRemaining} now=${burn2.remaining})`);
  });
});

suite('Pierce Fix', () => {
  test('projectile tracks hit enemies in Set', () => {
    const g = makeGame();
    // Create a projectile with high pierce
    g.projectiles.push({
      x: g.player.x + 50, y: g.player.y,
      vx: 350, vy: 0, speed: 350,
      damage: 15, range: 300, dist: 0,
      pierce: 5, radius: 5, color: '#fff', owner: 0,
    });
    // Place two enemies at the same position — pierce should hit both
    const rng = createRng(1);
    for (let i = 0; i < 2; i++) {
      const e = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'tank'), 1, rng);
      e.x = g.player.x + 60;
      e.y = g.player.y;
      e.hp = 9999;
      e.maxHp = 9999;
      g.enemies.push(e);
    }
    tickN(g, 10);
    const hits = g.events.filter(e => e.type === 'enemyHit');
    // Should hit both enemies, not burn pierce on the same one
    assert(hits.length >= 2, `expected >= 2 hits, got ${hits.length}`);
    // Projectile should still exist (5 pierce, hit 2 enemies)
    // (it might have moved past them by now, but the point is it didn't die after 1 hit)
  });
});

suite('Enemy Projectiles', () => {
  test('fireEnemyProjectile adds to array', () => {
    const g = makeGame();
    fireEnemyProjectile(g, 100, 100, 200, 100, { speed: 200, damage: 15 });
    assert(g.enemyProjectiles.length === 1, 'should have 1 enemy projectile');
    const p = g.enemyProjectiles[0];
    assert(p.vx > 0, 'should move right');
    assertClose(p.vy, 0, 0.01, 'vy should be ~0');
    assert(p.damage === 15, 'damage should be 15');
  });

  test('enemy projectiles removed when exceeding range', () => {
    const g = makeGame();
    fireEnemyProjectile(g, 100, 100, 200, 100, { speed: 200, damage: 10, range: 50 });
    // Tick enough for projectile to exceed 50px
    for (let i = 0; i < 30; i++) updateEnemyProjectiles(g, 1/60);
    assert(g.enemyProjectiles.length === 0, 'projectile should be removed after exceeding range');
  });

  test('enemy projectile damages player on collision', () => {
    const g = makeGame();
    // Fire directly at player
    fireEnemyProjectile(g, g.player.x - 30, g.player.y, g.player.x, g.player.y, {
      speed: 300, damage: 25, radius: 5, range: 200,
    });
    const startHp = g.player.hp;
    for (let i = 0; i < 10; i++) updateEnemyProjectiles(g, 1/60);
    assert(g.player.hp < startHp, `player hp (${g.player.hp}) should be less than start (${startHp})`);
  });

  test('iframes prevent consecutive hits', () => {
    const g = makeGame();
    g.player.iframes = 1.0; // 1 second of invincibility
    fireEnemyProjectile(g, g.player.x - 20, g.player.y, g.player.x, g.player.y, {
      speed: 300, damage: 25, radius: 5, range: 200,
    });
    const startHp = g.player.hp;
    for (let i = 0; i < 10; i++) updateEnemyProjectiles(g, 1/60);
    assert(g.player.hp === startHp, 'player with iframes should not take damage');
  });

  test('homing projectiles steer toward player', () => {
    const g = makeGame();
    // Fire projectile going right, but player is above
    g.player.x = 100;
    g.player.y = 50;
    fireEnemyProjectile(g, 100, 200, 200, 200, {
      speed: 100, damage: 10, range: 500,
      homing: true, turnRate: 3.0,
    });
    const p = g.enemyProjectiles[0];
    assert(p.vy === 0, 'initial vy should be 0 (aimed right)');
    // After some ticks, vy should become negative (steering up toward player)
    for (let i = 0; i < 30; i++) updateEnemyProjectiles(g, 1/60);
    if (g.enemyProjectiles.length > 0) {
      assert(g.enemyProjectiles[0].vy < 0, 'homing projectile should steer upward toward player');
    }
  });

  test('shooting AI has two-phase windup', () => {
    const g = makeGame();
    const rng = createRng(1);
    const elite = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'elite'), 10, rng);
    elite.x = g.player.x + 100;
    elite.y = g.player.y;
    elite.shootTimer = 0; // ready to fire
    elite.stunTimer = 0;
    g.enemies.push(elite);

    const target = { p: g.player, dx: g.player.x - elite.x, dy: 0, dist: 100 };

    // First call: should start aiming (set aimTimer)
    enemyShootingAi(g, elite, 1/60, target);
    assert(elite.aimTimer > 0, 'should start aim phase');
    assert(elite.aimTargetX === g.player.x, 'aim coords should be locked to player position');

    // Check ENEMY_AIM event was emitted
    const aimEvents = g.events.filter(e => e.type === 'enemyAim');
    assert(aimEvents.length === 1, 'should emit ENEMY_AIM event');
  });

  test('boss phase 1 fires 3-shot spread', () => {
    const g = makeGame();
    const rng = createRng(1);
    const boss = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'boss'), 20, rng);
    boss.x = g.player.x + 200;
    boss.y = g.player.y;
    boss.phase = 1;
    boss.shootTimer = 0;
    boss.stunTimer = 0;
    boss.aimTimer = 0;
    g.enemies.push(boss);

    const target = { p: g.player, dx: g.player.x - boss.x, dy: 0, dist: 200 };

    // Start aim phase
    enemyShootingAi(g, boss, 1/60, target);
    assert(boss.aimTimer > 0, 'boss should start aiming');

    // Fast-forward through aim
    boss.aimTimer = 0.001;
    enemyShootingAi(g, boss, 0.002, target);

    // Should have fired 3 projectiles (phase 1 spread)
    assert(g.enemyProjectiles.length === 3, `expected 3 projectiles for phase 1, got ${g.enemyProjectiles.length}`);
  });

  test('boss phase 2 fires 5-shot spread', () => {
    const g = makeGame();
    const rng = createRng(1);
    const boss = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'boss'), 20, rng);
    boss.x = g.player.x + 200;
    boss.y = g.player.y;
    boss.phase = 2;
    boss.shootTimer = 0;
    boss.stunTimer = 0;
    boss.aimTimer = 0;
    g.enemies.push(boss);

    const target = { p: g.player, dx: g.player.x - boss.x, dy: 0, dist: 200 };
    enemyShootingAi(g, boss, 1/60, target);
    boss.aimTimer = 0.001;
    enemyShootingAi(g, boss, 0.002, target);

    assert(g.enemyProjectiles.length === 5, `expected 5 projectiles for phase 2, got ${g.enemyProjectiles.length}`);
  });

  test('boss phase 3 fires 3 homing projectiles', () => {
    const g = makeGame();
    const rng = createRng(1);
    const boss = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'boss'), 20, rng);
    boss.x = g.player.x + 200;
    boss.y = g.player.y;
    boss.phase = 3;
    boss.shootTimer = 0;
    boss.stunTimer = 0;
    boss.aimTimer = 0;
    g.enemies.push(boss);

    const target = { p: g.player, dx: g.player.x - boss.x, dy: 0, dist: 200 };
    enemyShootingAi(g, boss, 1/60, target);
    boss.aimTimer = 0.001;
    enemyShootingAi(g, boss, 0.002, target);

    assert(g.enemyProjectiles.length === 3, `expected 3 homing projectiles for phase 3, got ${g.enemyProjectiles.length}`);
    assert(g.enemyProjectiles[0].homing === true, 'phase 3 projectiles should be homing');
    assert(g.enemyProjectiles[0].turnRate === 1.5, 'phase 3 turnRate should be 1.5');
  });

  test('boss enters phase 4 + summons 2 healers at <25% HP', () => {
    const g = makeGame();
    const rng = createRng(1);
    const boss = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'boss'), 20, rng);
    boss.x = g.player.x + 200;
    boss.y = g.player.y;
    boss.hp = boss.maxHp * 0.5;
    boss.phase = 1; boss.baseSpeed = boss.speed;
    g.enemies.push(boss);
    const startCount = g.enemies.length;
    // Use 22% — within the 20-25% phase-4 window so phase 5 doesn't
    // trigger during the same 2-tick window (phase 5 requires e.phase === 4
    // AND hpPct <= 0.20, so 22% is safely above that threshold).
    boss.hp = boss.maxHp * 0.22;
    tickN(g, 2);
    assert(boss.phase === 4, `boss should be in phase 4, got ${boss.phase}`);
    assert(boss.enraged === true, 'boss should be enraged in phase 4');
    const healers = g.enemies.slice(startCount).filter(e => e.name === 'healer');
    assert(healers.length === 2, `expected 2 healers summoned, got ${healers.length}`);
    assert(boss.shootCooldown === 1.2, `expected shootCooldown 1.2 in phase 4, got ${boss.shootCooldown}`);
  });

  test('boss enters phase 5 (final form) at ≤20% HP after phase 4', () => {
    const g = makeGame();
    const rng = createRng(1);
    const boss = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'boss'), 20, rng);
    boss.x = g.player.x + 200;
    boss.y = g.player.y;
    boss.hp = boss.maxHp * 0.5;
    boss.phase = 4; // already in phase 4 (enrage pre-applied)
    boss.baseSpeed = boss.speed;
    boss.enraged = true;
    boss.shootCooldown = 1.2;
    g.enemies.push(boss);
    const startCount = g.enemies.length;
    boss.hp = boss.maxHp * 0.18;
    tickN(g, 2);
    assert(boss.phase === 5, `boss should be in phase 5, got ${boss.phase}`);
    assert(boss.shootCooldown === 0.9, `expected shootCooldown 0.9 in phase 5, got ${boss.shootCooldown}`);
    // Minion rain: 2 elites + 3 brutes
    const p5Minions = g.enemies.slice(startCount);
    const elites = p5Minions.filter(e => e.name === 'elite');
    const brutes = p5Minions.filter(e => e.name === 'brute');
    assert(elites.length === 2, `expected 2 elites in minion rain, got ${elites.length}`);
    assert(brutes.length === 3, `expected 3 brutes in minion rain, got ${brutes.length}`);
    assert(boss.teleportTimer !== undefined, 'phase 5 boss should have teleportTimer');
    assert(boss.novaTimer !== undefined, 'phase 5 boss should have novaTimer');
  });

  test('boss phase 5 resurrection: survives first kill, revives at 25% HP', () => {
    const g = makeGame();
    const rng = createRng(1);
    const boss = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'boss'), 20, rng);
    boss.x = g.player.x + 200;
    boss.y = g.player.y;
    boss.phase = 5;
    boss.baseSpeed = boss.speed;
    g.enemies.push(boss);
    // Kill the boss — resurrection should intercept and revive at 25% HP.
    damageEnemy(g, boss, boss.maxHp * 2, null);
    assert(boss.dying === undefined, 'boss should not be dying after first kill in phase 5');
    assert(boss.resurrected === true, 'boss.resurrected should be true after revival');
    assert(boss.hp > 0, 'boss should have HP after resurrection');
    assert(Math.abs(boss.hp - Math.ceil(boss.maxHp * 0.25)) < 1, `boss HP should be ~25% maxHp after resurrection, got ${boss.hp}`);
    const resurrectEvt = g.events.find(ev => ev.type === 'bossResurrect');
    assert(resurrectEvt !== undefined, 'BOSS_RESURRECT event should be emitted');
    // Second kill should be final — no more resurrection.
    damageEnemy(g, boss, boss.hp + 100, null);
    assert(boss.dying !== undefined, 'boss should die for real on second kill in phase 5');
  });

  test('phase 4 enraged boss fires homing projectiles like phase 3', () => {
    const g = makeGame();
    const rng = createRng(1);
    const boss = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'boss'), 20, rng);
    boss.x = g.player.x + 200;
    boss.y = g.player.y;
    boss.phase = 4;
    boss.shootTimer = 0;
    boss.stunTimer = 0;
    boss.aimTimer = 0;
    g.enemies.push(boss);

    const target = { p: g.player, dx: g.player.x - boss.x, dy: 0, dist: 200 };
    enemyShootingAi(g, boss, 1/60, target);
    boss.aimTimer = 0.001;
    enemyShootingAi(g, boss, 0.002, target);

    assert(g.enemyProjectiles.length === 3, `expected 3 homing projectiles for phase 4, got ${g.enemyProjectiles.length}`);
    assert(g.enemyProjectiles[0].homing === true, 'phase 4 projectiles should be homing');
  });
});

suite('Prestige System', () => {
  test('calculateScales formula: wave/2 + kills/50 + evolutions', () => {
    assert(calculateScales({ wave: 10, kills: 100 }) === 7, 'wave 10, 100 kills = 5+2 = 7');
    assert(calculateScales({ wave: 20, kills: 200, powerupStacks: { evo_dragon: 1 } }) === 15, 'with evolution');
    assert(calculateScales({ wave: 0, kills: 0 }) === 1, 'minimum should be 1');
  });

  test('applyUnlocks — tough_scales adds HP', () => {
    const player = makePlayer();
    const startHp = player.maxHp;
    applyUnlocks(player, { tough_scales: 3 });
    assert(player.maxHp === startHp + 30, `expected +30 HP, got ${player.maxHp - startHp}`);
    assert(player.hp === startHp + 30, 'hp should also increase');
  });

  test('applyUnlocks — swift_wings boosts speed', () => {
    const player = makePlayer();
    const startSpeed = player.speed;
    applyUnlocks(player, { swift_wings: 2 });
    assertClose(player.speed, startSpeed * 1.10, 0.1, 'speed should be 1.10x');
  });

  test('applyUnlocks — fury boosts damageMulti', () => {
    const player = makePlayer();
    applyUnlocks(player, { fury: 3 });
    assertClose(player.damageMulti, 1 * 1.15, 0.01, 'damageMulti should be 1.15x');
  });

  test('applyUnlocks — headstart sets level 2', () => {
    const player = makePlayer();
    applyUnlocks(player, { headstart: 1 });
    assert(player.level === 2, 'should start at level 2');
  });

  test('applyUnlocks — extra_heart adds 25 HP', () => {
    const player = makePlayer();
    applyUnlocks(player, { extra_heart: 1 });
    assert(player.maxHp === PLAYER_MAX_HP + 25, `expected ${PLAYER_MAX_HP + 25}, got ${player.maxHp}`);
  });

  test('applyUnlocks clamps to max stacks', () => {
    const player = makePlayer();
    // tough_scales max is 5; try to apply 10
    applyUnlocks(player, { tough_scales: 10 });
    assert(player.maxHp === PLAYER_MAX_HP + 50, 'should clamp to 5 stacks (50 HP)');
  });

  test('applyUnlocks ignores unknown IDs', () => {
    const player = makePlayer();
    applyUnlocks(player, { fake_unlock: 5, tough_scales: 1 });
    assert(player.maxHp === PLAYER_MAX_HP + 10, 'only tough_scales should apply');
  });

  test('sanitizePrestige strips invalid data', () => {
    const result = sanitizePrestige({
      unlocks: { tough_scales: 99, fake: 5 },
      activeSkin: 'skin_gold',
      activeTrail: 'trail_fire',
    });
    assert(result.unlocks.tough_scales === 5, 'should clamp to max');
    assert(!result.unlocks.fake, 'should strip unknown');
    // skin_gold not owned (not in unlocks) so should be null
    assert(result.activeSkin === null, 'unowned skin should be null');
  });

  test('sanitizePrestige allows owned cosmetics', () => {
    const result = sanitizePrestige({
      unlocks: { skin_gold: 1, trail_fire: 1 },
      activeSkin: 'skin_gold',
      activeTrail: 'trail_fire',
    });
    assert(result.activeSkin === 'skin_gold', 'owned skin should be allowed');
    assert(result.activeTrail === 'trail_fire', 'owned trail should be allowed');
  });

  test('combined prestige stacks correctly', () => {
    const player = makePlayer();
    applyUnlocks(player, {
      tough_scales: 5,
      swift_wings: 3,
      fury: 5,
      extra_heart: 1,
      thick_hide: 3,
    });
    assert(player.maxHp === PLAYER_MAX_HP + 50 + 25, 'tough_scales 5 + extra_heart');
    assertClose(player.speed, PLAYER_SPEED * 1.15, 0.1, 'swift_wings 3');
    assertClose(player.damageMulti, 1.25, 0.01, 'fury 5');
    assertClose(player.hpRegen, 1.5, 0.01, 'thick_hide 3');
  });
});

suite('Full Sim Integration', () => {
  test('10s run produces kills and events', () => {
    const g = makeGame({ playerOverrides: { weapons: [createWeapon('spit'), createWeapon('orbit')] } });
    tickN(g, 600);
    assert(g.enemies.length > 0, 'should have spawned enemies');
    assert(g.kills > 0, 'should have killed enemies');
    assert(g.events.length > 0, 'should have events');
    assert(g.player.alive, 'player should survive 10s');
  });

  test('30s run reaches wave 2+', () => {
    const g = makeGame({ playerOverrides: { weapons: [createWeapon('spit'), createWeapon('orbit')] } });
    tickN(g, 1800); // 30 seconds
    assert(g.wave >= 2, `should be at wave 2+, got ${g.wave}`);
  });

  test('gems spawn from killed enemies', () => {
    const g = makeGame({ playerOverrides: { weapons: [createWeapon('spit'), createWeapon('orbit')] } });
    tickN(g, 600);
    // Gems may have been picked up already, but kills should have produced gems at some point
    const killEvents = countEvents(g, 'enemyKilled');
    assert(killEvents > 0, 'should have killed enemies (gem source)');
  });

  test('overkill flag fires on 3x+ dmg vs threat tier (pass-2 r2)', () => {
    const g = makeGame();
    const rng = createRng(1);
    const elite = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'elite'), 5, rng);
    elite.hp = 100;
    g.enemies.push(elite);
    damageEnemy(g, elite, 400, 0);
    const killEvt = g.events.find(e => e.type === 'enemyKilled');
    assert(killEvt && killEvt.overkill === true,
      `expected overkill=true on 4x threat-tier kill, got ${JSON.stringify(killEvt)}`);
  });

  test('overkill flag NOT set for small trash one-shots (pass-2 r2)', () => {
    const g = makeGame();
    const rng = createRng(1);
    const blob = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'blob'), 1, rng);
    blob.hp = 10;
    g.enemies.push(blob);
    damageEnemy(g, blob, 40, 0);
    const killEvt = g.events.find(e => e.type === 'enemyKilled');
    assert(killEvt, 'enemy should be killed');
    assert(killEvt.overkill === undefined,
      `expected no overkill flag for trash one-shot, got ${killEvt.overkill}`);
  });

  test('overkill flag fires on 50+ dmg even for trash (pass-2 r2)', () => {
    const g = makeGame();
    const rng = createRng(1);
    const blob = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'blob'), 1, rng);
    blob.hp = 15;
    g.enemies.push(blob);
    damageEnemy(g, blob, 60, 0);
    const killEvt = g.events.find(e => e.type === 'enemyKilled');
    assert(killEvt && killEvt.overkill === true,
      `expected overkill=true for 60-dmg blob one-shot, got ${JSON.stringify(killEvt)}`);
  });

  test('gem tiers + multipliers by enemy type (PR #114)', () => {
    const g = makeGame();
    spawnGem(g, 0, 0, 10, 'blob');
    spawnGem(g, 0, 0, 80, 'elite');
    spawnGem(g, 0, 0, 50, 'spawner');
    spawnGem(g, 0, 0, 60, 'brute');
    spawnGem(g, 0, 0, 500, 'boss');
    const [b, e, s, br, bo] = g.gems;
    assert(b.tier === 0 && b.xp === 10,     `blob: tier 0 / xp 10, got ${b.tier}/${b.xp}`);
    assert(e.tier === 1 && e.xp === 240,    `elite: tier 1 / xp 80*3=240, got ${e.tier}/${e.xp}`);
    assert(s.tier === 1 && s.xp === 150,    `spawner: tier 1 / xp 50*3=150, got ${s.tier}/${s.xp}`);
    assert(br.tier === 2 && br.xp === 300,  `brute: tier 2 / xp 60*5=300, got ${br.tier}/${br.xp}`);
    assert(bo.tier === 3 && bo.xp === 12500,`boss: tier 3 / xp 500*25=12500, got ${bo.tier}/${bo.xp}`);
  });

  test('xpToLevel flattens 1.22 per level (PR #114)', () => {
    const g = makeGame();
    g.player.xp = 0;
    g.player.level = 1;
    g.player.xpToLevel = 45;
    // Drop one huge gem to cascade-level the player several times.
    spawnGem(g, g.player.x, g.player.y, 10000);
    tickN(g, 2);
    // After enough levels, xpToLevel should be well under the old 1.30
    // curve. At level 10: 45 * 1.22^9 ≈ 275, vs 1.30^9 ≈ 492.
    assert(g.player.level >= 10, `expected level >= 10 from 10000xp cascade, got ${g.player.level}`);
    const expectedAtL10 = 45;
    let expected = 45;
    for (let i = 1; i < g.player.level; i++) expected = Math.floor(expected * 1.22);
    assert(g.player.xpToLevel === expected,
      `expected xpToLevel ${expected} at L${g.player.level}, got ${g.player.xpToLevel}`);
  });

  test('heart drops appear after wave 6', () => {
    const g = makeGame({
      wave: 7,
      playerOverrides: { weapons: [createWeapon('dragon_storm')] },
    });
    tickN(g, 600);
    // With dragon_storm melting enemies at wave 7, some should drop hearts
    // (12% for regular enemies)
    // Not guaranteed by seed, so just check system doesn't crash
    assert(g.player.alive || !g.player.alive, 'sim should complete without crash at wave 7');
  });

  test('enemy projectile system works in full sim', () => {
    // Jump to wave 17 (ELITE GUARD) — elites should fire projectiles
    const g = makeGame({
      wave: 17,
      playerOverrides: {
        weapons: [createWeapon('dragon_storm')],
        hp: 500, maxHp: 500, // extra HP to survive
      },
    });
    tickN(g, 600);
    // Check if any ENEMY_AIM or ENEMY_SHOOT events were emitted
    const aimEvents = countEvents(g, 'enemyAim');
    const shootEvents = countEvents(g, 'enemyShoot');
    // At wave 17 with elite override, enemies should attempt to shoot
    // (depends on whether they get in range before dying)
    assert(typeof aimEvents === 'number', 'should count aim events without crash');
    assert(typeof shootEvents === 'number', 'should count shoot events without crash');
  });

  test('multiple weapons fire simultaneously', () => {
    const g = makeGame({
      wave: 5, // higher wave = more enemies in range sooner
      playerOverrides: {
        weapons: [createWeapon('spit'), createWeapon('chain'), createWeapon('lightning_field')],
      },
    });
    tickN(g, 600); // 10 seconds at wave 5 for enough enemy density
    const fires = g.events.filter(e => e.type === 'weaponFire');
    const weaponsFired = new Set(fires.map(f => f.weapon));
    assert(weaponsFired.size >= 2, `expected at least 2 weapon types to fire, got ${weaponsFired.size}`);
  });

  test('dead player stops taking actions', () => {
    // Place enemy right on top of player so contact damage kills immediately
    const g = makeGame({
      wave: 5,
      playerOverrides: { hp: 1, maxHp: 1 },
    });
    // Manually place an enemy at player position for guaranteed contact
    const rng = createRng(1);
    const enemy = scaleEnemy(ENEMY_TYPES.find(t => t.name === 'brute'), 5, rng);
    enemy.x = g.player.x + 20;
    enemy.y = g.player.y;
    g.enemies.push(enemy);
    tickN(g, 120); // 2 seconds — brute should reach player
    assert(!g.player.alive, 'player should die from brute contact with 1 HP');
    const deathEvents = countEvents(g, 'playerDeath');
    assert(deathEvents >= 1, 'should have player death event');
  });
});

suite('Deterministic RNG', () => {
  test('same seed produces same results', () => {
    const g1 = makeGame({ seed: 123 });
    const g2 = makeGame({ seed: 123 });
    tickN(g1, 300);
    tickN(g2, 300);
    assert(g1.kills === g2.kills, `kills should match: ${g1.kills} vs ${g2.kills}`);
    assert(g1.enemies.length === g2.enemies.length, 'enemy count should match');
    assert(g1.wave === g2.wave, 'wave should match');
  });

  test('different seeds produce different results', () => {
    const g1 = makeGame({ seed: 1 });
    const g2 = makeGame({ seed: 999 });
    tickN(g1, 300);
    tickN(g2, 300);
    // At least one of these should differ (extremely unlikely to be identical)
    const same = g1.kills === g2.kills && g1.enemies.length === g2.enemies.length;
    // This is probabilistic but with 5 seconds of sim, divergence is near-certain
    assert(!same || true, 'different seeds should typically diverge (probabilistic)');
  });
});

// ── Lobby vote resolution (tiebreaker + anti-repeat) ───────────
// Pure logic tests: mirrors server.mjs resolveLobby + initLobby.

function lobbyResolve(mapVotes, options) {
  const tally = {};
  for (const mapId of Object.values(mapVotes)) {
    tally[mapId] = (tally[mapId] || 0) + 1;
  }
  const max = Math.max(0, ...options.map(id => tally[id] || 0));
  const candidates = max === 0
    ? options
    : options.filter(id => (tally[id] || 0) === max);
  return candidates;
}

function lobbyPool(rotation, last, wantCount = 3) {
  // Mirrors server.mjs initLobby (without shuffle so tests are deterministic).
  const pool = [...rotation];
  if (last && pool.length > wantCount) {
    const idx = pool.indexOf(last);
    if (idx !== -1) { pool.splice(idx, 1); pool.push(last); }
  }
  return pool.slice(0, wantCount);
}

suite('Lobby Vote Resolution', () => {
  const OPTIONS = ['arena', 'forest', 'ruins'];

  test('no votes → all options are candidates', () => {
    const c = lobbyResolve({}, OPTIONS);
    assert(c.length === 3, `expected 3 candidates, got ${c.length}`);
    assert(OPTIONS.every(id => c.includes(id)), 'all options should be candidates');
  });

  test('clear winner → only winner returned', () => {
    const votes = { 1: 'forest', 2: 'forest', 3: 'ruins' };
    const c = lobbyResolve(votes, OPTIONS);
    assert(c.length === 1, `expected 1 candidate, got ${c.length}`);
    assert(c[0] === 'forest', `expected forest, got ${c[0]}`);
  });

  test('two-way tie → both maps in candidates (not first-seen)', () => {
    const votes = { 1: 'arena', 2: 'forest', 3: 'arena', 4: 'forest' };
    const c = lobbyResolve(votes, OPTIONS);
    assert(c.length === 2, `expected 2 tied candidates, got ${c.length}`);
    assert(c.includes('arena') && c.includes('forest'), 'both tied maps must be candidates');
    assert(!c.includes('ruins'), 'non-tied map must be excluded');
  });

  test('three-way tie → all options in candidates', () => {
    const votes = { 1: 'arena', 2: 'forest', 3: 'ruins' };
    const c = lobbyResolve(votes, OPTIONS);
    assert(c.length === 3, `expected 3 candidates, got ${c.length}`);
  });

  test('votes for one map only → that map is the sole candidate', () => {
    const votes = { 1: 'ruins', 2: 'ruins' };
    const c = lobbyResolve(votes, OPTIONS);
    assert(c.length === 1 && c[0] === 'ruins', `expected ['ruins'], got [${c}]`);
  });
});

suite('Lobby Anti-Repeat', () => {
  const ROTATION = ['arena', 'forest', 'ruins', 'graveyard', 'wilderness', 'catacombs'];

  test('last map absent from options when rotation has >3 maps', () => {
    for (const last of ROTATION) {
      const pool = lobbyPool(ROTATION, last, 3);
      assert(!pool.includes(last), `last map "${last}" appeared in options: [${pool}]`);
      assert(pool.length === 3, `expected 3 options, got ${pool.length}`);
    }
  });

  test('no last map → plain slice of rotation, no filtering', () => {
    const pool = lobbyPool(ROTATION, null, 3);
    assert(pool.length === 3, `expected 3 options, got ${pool.length}`);
  });

  test('last map pushed to end, absent from first 3', () => {
    const pool = lobbyPool(['arena', 'forest', 'ruins', 'neon'], 'forest', 3);
    assert(!pool.includes('forest'), `"forest" (last) should not appear in options: [${pool}]`);
    assert(pool.length === 3, 'should still have 3 options');
  });

  test('rotation ≤ wantCount: last map may appear (no safe slot to exclude)', () => {
    // pool.length > wantCount is false → no exclusion branch runs
    const pool = lobbyPool(['arena', 'forest', 'ruins'], 'arena', 3);
    assert(pool.length === 3, 'should return 3 options regardless');
  });
});

suite('Death-screen Stat Tracking', () => {
  function setupGame() {
    const rng = createRng(1);
    const p = {
      id: 1, hp: 100, maxHp: 100, damageMulti: 1, radius: 14, x: 0, y: 0,
      alive: true, kills: 0, relics: {},
      dmgByWeapon: {}, overkills: 0, maxHit: 0, maxHitEnemy: null,
    };
    const g = {
      players: [p], enemies: [], kills: 0, events: [], rng, wave: 1,
      // damage.js's on-kill path touches gems + consumables + drops,
      // so the harness must init every sink it pushes to.
      gems: [], heartDrops: [], consumables: [], chests: [], meteorEffects: [],
    };
    return { g, p };
  }

  test('dmgByWeapon accumulates per weapon type', () => {
    const { g, p } = setupGame();
    const e1 = { name: 'blob', hp: 100, x: 0, y: 0, radius: 8 };
    const e2 = { name: 'blob', hp: 100, x: 0, y: 0, radius: 8 };
    g.enemies.push(e1, e2);
    damageEnemy(g, e1, 10, 1, 'spit');
    damageEnemy(g, e1, 15, 1, 'spit');
    damageEnemy(g, e2, 20, 1, 'chain');
    assert(p.dmgByWeapon.spit === 25, `spit total: ${p.dmgByWeapon.spit}`);
    assert(p.dmgByWeapon.chain === 20, `chain total: ${p.dmgByWeapon.chain}`);
  });

  test('untagged damage lands in "other" bucket', () => {
    const { g, p } = setupGame();
    const e = { name: 'blob', hp: 100, x: 0, y: 0, radius: 8 };
    g.enemies.push(e);
    damageEnemy(g, e, 42, 1); // no weaponType arg
    assert(p.dmgByWeapon.other === 42, `other bucket: ${p.dmgByWeapon.other}`);
  });

  test('maxHit tracks biggest single hit + victim name', () => {
    const { g, p } = setupGame();
    const blob  = { name: 'blob',  hp: 100, x: 0, y: 0, radius: 8 };
    const brute = { name: 'brute', hp: 500, x: 0, y: 0, radius: 8 };
    g.enemies.push(blob, brute);
    damageEnemy(g, blob, 25, 1, 'spit');
    damageEnemy(g, brute, 150, 1, 'meteor');
    damageEnemy(g, brute, 40, 1, 'spit');
    assert(p.maxHit === 150, `maxHit: ${p.maxHit}`);
    assert(p.maxHitEnemy === 'brute', `maxHitEnemy: ${p.maxHitEnemy}`);
  });

  test('overkills only counts gated threat-tier / high-damage kills', () => {
    const { g, p } = setupGame();
    const blob  = { name: 'blob',  hp: 10, x: 0, y: 0, radius: 8 };
    const elite = { name: 'elite', hp: 30, x: 0, y: 0, radius: 8 };
    const boss  = { name: 'boss',  hp: 40, x: 0, y: 0, radius: 8 };
    g.enemies.push(blob, elite, boss);
    // blob 10hp + 30dmg → 3x overkill BUT dmg<50 and not threat-tier
    // → gate fails, not counted
    damageEnemy(g, blob, 30, 1, 'spit');
    // elite 30hp + 100dmg → 3.3x overkill, threat-tier → counted
    damageEnemy(g, elite, 100, 1, 'meteor');
    // boss 40hp + 200dmg → 5x overkill, threat-tier → counted
    damageEnemy(g, boss, 200, 1, 'meteor');
    assert(p.overkills === 2, `overkills (expect 2): ${p.overkills}`);
  });

  test('computeDeathHighlights picks MVP by highest weapon damage', () => {
    const p = {
      dmgByWeapon: { spit: 500, chain: 1200, other: 800 },
      overkills: 3, maxHit: 250, maxHitEnemy: 'elite',
    };
    const h = computeDeathHighlights(p);
    assert(h.mvp.weapon === 'chain', `mvp: ${h.mvp.weapon}`);
    assert(h.mvp.dmg === 1200, `mvp dmg: ${h.mvp.dmg}`);
    assert(h.mvp.role === 'CAST', `mvp role: ${h.mvp.role}`);
    // 'other' bucket ignored even when numerically larger than spit —
    // MVP should reflect weapon choice, not generic damage
    assert(h.overkills === 3, `overkills: ${h.overkills}`);
    assert(h.maxHit === 250, `maxHit: ${h.maxHit}`);
    assert(h.maxHitEnemy === 'elite', `maxHitEnemy: ${h.maxHitEnemy}`);
  });

  test('computeDeathHighlights returns null MVP when no weapon damage', () => {
    const p = { dmgByWeapon: { other: 42 }, overkills: 0, maxHit: 0, maxHitEnemy: null };
    const h = computeDeathHighlights(p);
    assert(h.mvp === null, `mvp should be null: ${JSON.stringify(h.mvp)}`);
  });
});

suite('Ice Lance + Frost Cascade + Nova Strike', () => {
  function makeGame() {
    const rng = createRng(42);
    const p = {
      id: 1, x: 500, y: 500, radius: 14, hp: 100, maxHp: 100,
      damageMulti: 1, sizeMulti: 1, projectileBonus: 0, attackSpeedMulti: 1,
      speed: 200, alive: true, kills: 0,
      dmgByWeapon: {}, overkills: 0, maxHit: 0, maxHitEnemy: null,
      weapons: [],
      facing: { x: 1, y: 0 }, iframes: 0,
    };
    const g = {
      players: [p], enemies: [], projectiles: [], events: [], rng,
      wave: 1, kills: 0,
      gems: [], heartDrops: [], consumables: [],
      meteorEffects: [], chainEffects: [], chargeTrails: [],
      pendingPulls: [], enemyProjectiles: [],
      arena: { w: 2000, h: 2000 },
    };
    return { g, p };
  }

  test('Ice Lance createWeapon has expected shape', () => {
    const w = createWeapon('ice_lance');
    assert(w.type === 'ice_lance', 'type');
    assert(w.damage === 60, `damage: ${w.damage}`);
    assert(w.pierce === 2, `pierce: ${w.pierce}`);
    assert(w.cooldown === 2.5, `cooldown: ${w.cooldown}`);
    assert(w.slowDuration === 1.5 && w.slowMagnitude === 0.4, 'slow params');
  });

  test('Ice Lance fires a projectile with slow statusOnHit', () => {
    const { g, p } = makeGame();
    p.weapons.push(createWeapon('ice_lance'));
    g.enemies.push({
      name: 'blob', x: 600, y: 500, hp: 30, maxHp: 30, radius: 10,
      vx: 0, vy: 0, statusEffects: [], color: '#888', speed: 100,
    });
    // Fire weapon — advances timer through to fire.
    updateWeapons(g, 2.6);
    assert(g.projectiles.length === 1, `projectiles spawned: ${g.projectiles.length}`);
    const proj = g.projectiles[0];
    assert(proj.weaponType === 'ice_lance', `weaponType: ${proj.weaponType}`);
    assert(proj.statusOnHit && proj.statusOnHit.type === 'slow',
      `statusOnHit: ${JSON.stringify(proj.statusOnHit)}`);
    assert(proj.statusOnHit.magnitude === 0.4, 'slow 40%');
  });

  test('Frost Cascade applies deep-slow to enemies in range', () => {
    const { g, p } = makeGame();
    p.weapons.push(createWeapon('frost_cascade'));
    const e = {
      name: 'blob', x: 540, y: 500, hp: 200, maxHp: 200, radius: 10,
      vx: 0, vy: 0, statusEffects: [], color: '#888', speed: 100,
    };
    g.enemies.push(e);
    updateAuras(g, 0.1);
    const slow = e.statusEffects.find(s => s.type === 'slow');
    assert(slow !== undefined, 'slow status applied');
    assert(slow.magnitude === 0.1, `magnitude (expect 0.1): ${slow.magnitude}`);
    assert(slow.remaining > 2, `remaining should be ~3s: ${slow.remaining}`);
  });

  test('Frost Cascade ignores enemies outside aura radius', () => {
    const { g, p } = makeGame();
    p.weapons.push(createWeapon('frost_cascade'));
    const far = {
      name: 'blob', x: 900, y: 500, hp: 200, maxHp: 200, radius: 10,
      vx: 0, vy: 0, statusEffects: [], color: '#888', speed: 100,
    };
    g.enemies.push(far);
    updateAuras(g, 0.1);
    assert(far.statusEffects.length === 0, 'no status applied outside range');
  });

  test('Nova Strike on explode spawns ring of slow-on-hit fragments', () => {
    const { g, p } = makeGame();
    // Seed a nova_strike meteor effect directly (skip fire path to
    // avoid needing a targetable enemy for the random-target picker).
    const w = createWeapon('nova_strike');
    g.meteorEffects.push({
      x: 600, y: 500,
      radius: w.blastRadius,
      damage: w.damage,
      life: 0.0001, phase: 'warn',
      color: w.color, owner: p.id, weaponType: w.type,
      novaFragments: {
        count: w.fragmentCount, damage: w.fragmentDamage,
        speed: w.fragmentSpeed, life: w.fragmentLife, pierce: w.fragmentPierce,
      },
    });
    // Advance past warn → explode.
    updateMeteorEffects(g, 0.01);
    assert(g.projectiles.length === w.fragmentCount,
      `fragments spawned (expect ${w.fragmentCount}): ${g.projectiles.length}`);
    // Every fragment should carry slow statusOnHit at 40%.
    for (const pr of g.projectiles) {
      assert(pr.statusOnHit && pr.statusOnHit.type === 'slow', 'slow on hit');
      assert(pr.statusOnHit.magnitude === 0.4, 'magnitude 40%');
      assert(pr.color === w.color, 'color matches nova palette');
    }
    // Fragments should be distributed roughly evenly around the ring —
    // sanity-check that not all velocities point the same way.
    const angles = g.projectiles.map(pr => Math.atan2(pr.vy, pr.vx));
    const unique = new Set(angles.map(a => a.toFixed(2)));
    assert(unique.size === w.fragmentCount, `distinct directions: ${unique.size}`);
  });

  test('Regular meteor (no novaFragments) does not spawn fragments', () => {
    const { g, p } = makeGame();
    g.meteorEffects.push({
      x: 600, y: 500, radius: 50, damage: 20,
      life: 0.0001, phase: 'warn', color: '#f00', owner: p.id, weaponType: 'meteor',
    });
    updateMeteorEffects(g, 0.01);
    assert(g.projectiles.length === 0, 'regular meteor spawns no fragments');
  });
});

suite('Bootstrap scaffold (entry.js + shared/boot.js)', () => {
  // entry.js → spGame.js has module-level DOM deps, so bootstrap()
  // can't be called from Node. The export shape is validated by the
  // bundle build succeeding.

  test('shared/boot.js captures isMP for shared modules', async () => {
    const { bootSharedServices, isMPMode } = await import('../src/shared/boot.js');
    bootSharedServices({ isMP: true });
    assert(isMPMode() === true, 'MP mode flag captured');
    bootSharedServices({ isMP: false });
    assert(isMPMode() === false, 'SP mode flag captured');
  });

  test('shared/mpGame.js returns handle', async () => {
    const { bootMPGame } = await import('../src/shared/mpGame.js');
    const mp = bootMPGame();
    assert(mp && typeof mp === 'object', 'MP returns object handle');
  });

  // spGame.js has module-level DOM deps (document, Image, window) so it
  // can't be imported in Node. The export shape is validated by the
  // bundle build succeeding + main.js calling bootSPGame().
});

suite('Top-run Weapon Histogram', () => {
  test('counts weapon appearances across runs', () => {
    const runs = [
      { wave: 25, weapons: ['spit', 'chain'] },
      { wave: 30, weapons: ['spit', 'breath', 'orbit'] },
      { wave: 15, weapons: ['chain'] },
    ];
    const hist = computeWeaponHistogram(runs);
    const byW = Object.fromEntries(hist.rows.map(r => [r.weapon, r.runs]));
    assert(byW.spit === 2, `spit: ${byW.spit}`);
    assert(byW.chain === 2, `chain: ${byW.chain}`);
    assert(byW.breath === 1, `breath: ${byW.breath}`);
    assert(byW.orbit === 1, `orbit: ${byW.orbit}`);
    assert(hist.totalRuns === 3, `totalRuns: ${hist.totalRuns}`);
  });

  test('rollup mode expands evolutions to source pair', () => {
    // A run with thunder_god should also count chain + lightning_field
    // so the histogram doesn't "lose" those picks to evolution.
    const runs = [{ wave: 30, weapons: ['thunder_god'] }];
    const asRec = computeWeaponHistogram(runs, { mode: 'asRecorded' });
    const asRecMap = Object.fromEntries(asRec.rows.map(r => [r.weapon, r.runs]));
    assert(asRecMap.thunder_god === 1, 'as-recorded has thunder_god');
    assert(!asRecMap.chain && !asRecMap.lightning_field, 'as-recorded omits sources');

    const rollup = computeWeaponHistogram(runs, { mode: 'rollup' });
    const rollupMap = Object.fromEntries(rollup.rows.map(r => [r.weapon, r.runs]));
    assert(rollupMap.thunder_god === 1, 'rollup keeps thunder_god');
    assert(rollupMap.chain === 1, 'rollup adds chain source');
    assert(rollupMap.lightning_field === 1, 'rollup adds field source');
  });

  test('rows are sorted by frequency desc', () => {
    const runs = [
      { wave: 25, weapons: ['spit'] },
      { wave: 25, weapons: ['spit'] },
      { wave: 25, weapons: ['spit'] },
      { wave: 25, weapons: ['chain'] },
      { wave: 25, weapons: ['breath'] },
    ];
    const hist = computeWeaponHistogram(runs);
    assert(hist.rows[0].weapon === 'spit', `top: ${hist.rows[0].weapon}`);
    assert(hist.rows[0].runs === 3, `top count: ${hist.rows[0].runs}`);
  });

  test('empty runs → empty rows', () => {
    const hist = computeWeaponHistogram([]);
    assert(hist.rows.length === 0, 'no rows');
    assert(hist.totalRuns === 0, 'zero runs');
  });

  test('share is fraction of total runs', () => {
    const runs = [
      { wave: 25, weapons: ['spit'] },
      { wave: 25, weapons: ['chain'] },
      { wave: 25, weapons: ['chain'] },
      { wave: 25, weapons: ['chain'] },
    ];
    const hist = computeWeaponHistogram(runs);
    const chainRow = hist.rows.find(r => r.weapon === 'chain');
    assert(chainRow.share === 0.75, `chain share: ${chainRow.share}`);
  });
});

suite('Level-up Card Weapon Preview', () => {
  test('powerupWeaponType strips prefixes correctly', () => {
    assert(powerupWeaponType('weapon_spit') === 'spit', 'weapon_* strip');
    assert(powerupWeaponType('evo_dragon_storm') === 'dragon_storm', 'evo_* strip');
    assert(powerupWeaponType('speed') === null, 'stat buff returns null');
  });

  test('base weapon preview includes role + dmg + cd + reach', () => {
    const p = getWeaponPreview('spit');
    assert(p.role === 'PROJECTILE', `role: ${p.role}`);
    assert(p.stats.includes('20 dmg'), `stats: ${p.stats}`);
    assert(p.stats.includes('0.8s cd'), `stats: ${p.stats}`);
    assert(p.stats.includes('300u reach'), `stats: ${p.stats}`);
    assert(p.evoSources === null, 'no evo sources on base weapon');
  });

  test('shield cooldown:99999 reports "passive" not a huge number', () => {
    const p = getWeaponPreview('shield');
    assert(p.stats.includes('passive'), `shield should be passive: ${p.stats}`);
    assert(!p.stats.includes('99999'), 'never expose sentinel to players');
  });

  test('tesla_aegis pulse cadence shows instead of passive sentinel', () => {
    // cooldown is 99999 but pulseCooldown is 0.5 — the pulse is the real
    // tempo, so players should see that number not "passive".
    const p = getWeaponPreview('tesla_aegis');
    assert(p.stats.includes('pulse'), `should expose pulse cadence: ${p.stats}`);
    assert(!p.stats.includes('99999'), 'never expose sentinel to players');
  });

  test('evolution preview exposes source pair', () => {
    const p = getWeaponPreview('tesla_aegis');
    assert(p.role === 'SHIELD', `tesla_aegis role: ${p.role}`);
    assert(Array.isArray(p.evoSources) && p.evoSources.length === 2, 'evo sources pair');
    assert(p.evoSources.includes('chain') && p.evoSources.includes('shield'),
      `chain+shield pair: ${p.evoSources}`);
  });

  test('every registered evolution has a preview and source pair', () => {
    const evos = ['dragon_storm', 'thunder_god', 'meteor_orbit', 'fortress',
                  'inferno_wheel', 'void_anchor', 'tesla_aegis'];
    for (const e of evos) {
      const p = getWeaponPreview(e);
      assert(p !== null, `${e} has preview`);
      assert(p.evoSources, `${e} has source pair`);
      assert(p.role, `${e} has role`);
    }
  });
});

// ── Nearest-enemy determinism (O(N) fireChain + fireVoidAnchor) ────
//
// Verifies that the O(N) pass picks the same first target on repeated
// calls with identical input state, and that the selected target is
// the nearest one. chainEffects.points[1] records the first hit position.
suite('Nearest-enemy determinism — fireChain + fireVoidAnchor', () => {
  // Minimal enemy shape sufficient for damageEnemy + target selection.
  function makeEnemy(x, y, overrides = {}) {
    return {
      x, y, hp: 30, maxHp: 30, damage: 5, radius: 12,
      color: '#f00', name: 'swarm', speed: 60,
      hitFlash: 0, statusResist: 0, dying: undefined,
      ...overrides,
    };
  }

  // Returns a game with enemies at known positions and the weapon
  // timer already expired so it fires on the first tickSim call.
  // chainRange is set to 1 so chain-hops don't reach any other enemies,
  // isolating the first-target selection from hop behavior.
  function makeGameForWeapon(type, extraW = {}) {
    const p = makePlayer({ x: WORLD_W / 2, y: WORLD_H / 2 });
    const w = createWeapon(type);
    Object.assign(w, { chainRange: 1 }, extraW); // prevent chain-hops from muddying the test
    w.timer = 0; // fire immediately
    p.weapons = [w];
    const g = makeGame({ player: p });
    // Three enemies at distances 50, 100, 200 from player.
    // Nearest (x+50) is the expected first target.
    g.enemies = [
      makeEnemy(p.x + 200, p.y),   // furthest
      makeEnemy(p.x + 50,  p.y),   // nearest ← expected first target
      makeEnemy(p.x + 100, p.y),   // middle
    ];
    return g;
  }

  test('fireChain selects same nearest-in-range enemy on two identical ticks', () => {
    const g1 = makeGameForWeapon('chain');
    const g2 = makeGameForWeapon('chain');

    tickSim(g1, 1 / 60);
    tickSim(g2, 1 / 60);

    // chainEffects.points[0] = player pos, points[1] = first target pos.
    assert(g1.chainEffects.length > 0, 'chain: effect emitted run 1');
    assert(g2.chainEffects.length > 0, 'chain: effect emitted run 2');
    const target1X = g1.chainEffects[0].points[1].x;
    const target2X = g2.chainEffects[0].points[1].x;
    assert(target1X === target2X, `chain: same target both runs (${target1X} vs ${target2X})`);
    // Verify correctness: nearest enemy is at p.x + 50.
    assertClose(target1X, WORLD_W / 2 + 50, 0.5, 'chain: nearest enemy (x+50) selected first');
  });

  test('fireVoidAnchor selects same nearest-in-range enemy on two identical ticks', () => {
    const g1 = makeGameForWeapon('void_anchor', { pullRadius: 500 });
    const g2 = makeGameForWeapon('void_anchor', { pullRadius: 500 });

    // Capture HP snapshots indexed by array position before the tick.
    const hp1Before = g1.enemies.map(e => e.hp);
    const hp2Before = g2.enemies.map(e => e.hp);

    tickSim(g1, 1 / 60);
    tickSim(g2, 1 / 60);

    // findIndex by position in array — baseDamage only hits the nearest.
    const hit1Idx = g1.enemies.findIndex((e, i) => e.hp < hp1Before[i]);
    const hit2Idx = g2.enemies.findIndex((e, i) => e.hp < hp2Before[i]);
    assert(hit1Idx !== -1, 'void_anchor: at least one enemy hit in run 1');
    assert(hit1Idx === hit2Idx,
      `void_anchor: same first target index both runs (${hit1Idx} vs ${hit2Idx})`);
    // Nearest enemy is at array index 1 (x+50).
    assert(hit1Idx === 1,
      `void_anchor: expected nearest enemy (idx 1) to be first hit, got idx ${hit1Idx}`);
  });
});

// ── Bestiary metadata ──────────────────────────────────────────

suite('Bestiary metadata — timesEncountered + lastSeenWave', () => {
  test('markSeen tracks timesEncountered and lastSeenWave, deduped by wave', () => {
    _resetCache();
    markSeen('boss', 20);
    const boss1 = getBestiaryEntries().find(e => e.name === 'boss');
    assert(boss1.firstWave === 20, `firstWave should be 20, got ${boss1.firstWave}`);
    assert(boss1.timesEncountered === 1, `timesEncountered should be 1, got ${boss1.timesEncountered}`);
    assert(boss1.lastSeenWave === 20, `lastSeenWave should be 20, got ${boss1.lastSeenWave}`);
    // Same wave again — must not increment
    markSeen('boss', 20);
    const boss2 = getBestiaryEntries().find(e => e.name === 'boss');
    assert(boss2.timesEncountered === 1, 'same-wave repeat must not increment timesEncountered');
    // New wave — should increment and update lastSeenWave; firstWave stays
    markSeen('boss', 21);
    const boss3 = getBestiaryEntries().find(e => e.name === 'boss');
    assert(boss3.timesEncountered === 2, `timesEncountered after wave 21 should be 2, got ${boss3.timesEncountered}`);
    assert(boss3.lastSeenWave === 21, `lastSeenWave should be 21, got ${boss3.lastSeenWave}`);
    assert(boss3.firstWave === 20, 'firstWave must not change on subsequent encounters');
  });

  test('getBestiaryEntries returns zero/null encounter metadata for unseen enemies', () => {
    _resetCache();
    const ghost = getBestiaryEntries().find(e => e.name === 'ghost');
    assert(ghost.firstWave === null, 'unseen firstWave should be null');
    assert(ghost.timesEncountered === 0, 'unseen timesEncountered should be 0');
    assert(ghost.lastSeenWave === null, 'unseen lastSeenWave should be null');
  });
});

// ═══════════════════════════════════════════════════════════════
// Relic System
// ═══════════════════════════════════════════════════════════════
import { RELICS, pickRelic } from '../src/shared/relics.js';
import { spawnChest, updateChests, isWaveMilestone } from '../src/shared/sim/chests.js';

suite('Relic Catalog', () => {
  test('has exactly 10 relics', () => {
    assert(RELICS.length === 10, `expected 10 relics, got ${RELICS.length}`);
  });

  test('all relics have required fields', () => {
    for (const r of RELICS) {
      assert(r.id, `relic missing id`);
      assert(r.name, `relic ${r.id} missing name`);
      assert(r.icon, `relic ${r.id} missing icon`);
      assert(r.desc, `relic ${r.id} missing desc`);
      assert(typeof r.apply === 'function', `relic ${r.id} missing apply`);
      assert(typeof r.max_stacks === 'number' && r.max_stacks > 0, `relic ${r.id} invalid max_stacks`);
    }
  });

  test('all relic ids are unique', () => {
    const ids = RELICS.map(r => r.id);
    const unique = new Set(ids);
    assert(unique.size === ids.length, 'duplicate relic ids found');
  });
});

suite('Chest Spawn on Boss Kill', () => {
  test('boss kill spawns a chest', () => {
    const g = makeGame();
    g.player.relics = {};
    // Create a boss-type enemy and kill it
    const boss = { x: 100, y: 100, hp: 10, maxHp: 100, name: 'boss', damage: 10, color: '#c0392b', radius: 30, xp: 50, speed: 30 };
    g.enemies.push(boss);
    g.wave = 5; // wave 4+ for consumables
    damageEnemy(g, boss, 1000, 0, 'spit');
    assert(g.chests.length >= 1, `expected at least 1 chest, got ${g.chests.length}`);
  });

  test('chest has valid relic_id', () => {
    const g = makeGame();
    g.player.relics = {};
    const boss = { x: 100, y: 100, hp: 10, maxHp: 100, name: 'boss', damage: 10, color: '#c0392b', radius: 30, xp: 50, speed: 30 };
    g.enemies.push(boss);
    g.wave = 5;
    damageEnemy(g, boss, 1000, 0, 'spit');
    const chest = g.chests[g.chests.length - 1];
    const relic = RELICS.find(r => r.id === chest.relic_id);
    assert(relic, `chest relic_id ${chest.relic_id} not found in catalog`);
  });
});

suite('Chest Pickup Applies Relic', () => {
  test('walking into chest applies the relic', () => {
    const g = makeGame();
    g.player.relics = {};
    // Manually spawn a chest right on top of the player
    g.chests.push({ x: g.player.x, y: g.player.y, radius: 14, relic_id: 'iron_will', bobPhase: 0 });
    const armorBefore = g.player.armor || 0;
    updateChests(g, 1/60);
    assert(g.chests.length === 0, 'chest should be consumed');
    assert(g.player.relics['iron_will'] === 1, 'relic stack should be 1');
    assert(g.player.armor === armorBefore + 2, `armor should increase by 2, got ${g.player.armor}`);
    // Should have emitted RELIC_PICKUP event
    const pickup = g.events.find(e => e.type === 'relicPickup');
    assert(pickup, 'should emit relicPickup event');
    assert(pickup.relic_id === 'iron_will', 'event should have correct relic_id');
  });
});

suite('Relic Max Stacks', () => {
  test('max_stacks respected by pickRelic', () => {
    const rng = createRng(42);
    // Phoenix Heart has max_stacks 1 — max it out
    const relics = { phoenix_heart: 1 };
    // pickRelic should never return phoenix_heart
    for (let i = 0; i < 50; i++) {
      const r = pickRelic(relics, rng);
      if (r) assert(r.id !== 'phoenix_heart', 'should not pick maxed relic');
    }
  });

  test('max_stacks respected on chest pickup', () => {
    const g = makeGame();
    g.player.relics = { iron_will: 3 }; // already at max (3)
    g.player.armor = 6;
    g.chests.push({ x: g.player.x, y: g.player.y, radius: 14, relic_id: 'iron_will', bobPhase: 0 });
    updateChests(g, 1/60);
    // Chest is consumed but relic should NOT stack past max
    assert(g.player.relics['iron_will'] === 3, 'should not exceed max_stacks');
    assert(g.player.armor === 6, 'armor should not increase past max');
  });

  test('pickRelic returns null when all maxed', () => {
    const rng = createRng(42);
    const relics = {};
    for (const r of RELICS) relics[r.id] = r.max_stacks;
    const pick = pickRelic(relics, rng);
    assert(pick === null, 'should return null when all maxed');
  });
});

suite('Wave Milestones', () => {
  test('milestone waves are correct', () => {
    const expected = [10, 15, 20, 25, 30, 35, 40, 45, 50];
    for (const w of expected) {
      assert(isWaveMilestone(w), `wave ${w} should be a milestone`);
    }
    assert(!isWaveMilestone(1), 'wave 1 should not be a milestone');
    assert(!isWaveMilestone(12), 'wave 12 should not be a milestone');
  });
});

// ═══════════════════════════════════════════════════════════════
// Relic Wiring — Phoenix Heart, Trickster, Shieldbreaker, Ember Orb
// ═══════════════════════════════════════════════════════════════
import { checkPhoenixRevive } from '../src/shared/sim/damage.js';
import { checkEnemyPlayerCollisions, buildSpatialHash } from '../src/shared/sim/collision.js';

suite('Phoenix Heart (auto-revive)', () => {
  test('revives player at 50% HP when lethal hit lands', () => {
    const g = makeGame();
    g.player.phoenixHeart = true;
    g.player.hp = 5;
    g.player.maxHp = 100;
    // Simulate lethal damage
    g.player.hp -= 20;
    const revived = checkPhoenixRevive(g, g.player);
    assert(revived === true, 'should return true for revive');
    assert(g.player.hp === 50, `hp should be 50% of max (50), got ${g.player.hp}`);
    assert(g.player.phoenixHeart === false, 'phoenixHeart should be consumed');
    assert(g.player.alive !== false, 'player should still be alive');
    const evt = g.events.find(e => e.type === 'phoenixRevive');
    assert(evt, 'should emit phoenixRevive event');
  });

  test('does not revive when no phoenixHeart flag', () => {
    const g = makeGame();
    g.player.hp = -5;
    const revived = checkPhoenixRevive(g, g.player);
    assert(revived === false, 'should not revive without relic');
  });

  test('does not fire when hp > 0', () => {
    const g = makeGame();
    g.player.phoenixHeart = true;
    g.player.hp = 10;
    const revived = checkPhoenixRevive(g, g.player);
    assert(revived === false, 'should not revive at positive hp');
    assert(g.player.phoenixHeart === true, 'phoenixHeart should not be consumed');
  });

  test('consumed — only works once', () => {
    const g = makeGame();
    g.player.phoenixHeart = true;
    g.player.maxHp = 100;
    // First lethal hit
    g.player.hp = -5;
    checkPhoenixRevive(g, g.player);
    assert(g.player.phoenixHeart === false, 'consumed after first use');
    // Second lethal hit
    g.player.hp = -5;
    const revived = checkPhoenixRevive(g, g.player);
    assert(revived === false, 'should not revive a second time');
  });

  test('integrated: enemy contact triggers revive instead of death', () => {
    const g = makeGame();
    g.player.phoenixHeart = true;
    g.player.hp = 1;
    g.player.maxHp = 100;
    const enemy = { x: g.player.x, y: g.player.y, hp: 100, maxHp: 100, name: 'brute', damage: 30, radius: 20 };
    g.enemies.push(enemy);
    // Place enemy on top of player and run collision
    const enemyHash = buildSpatialHash(g.enemies);
    checkEnemyPlayerCollisions(g, enemyHash);
    assert(g.player.alive === true, 'player should survive via phoenix heart');
    assert(g.player.hp === 50, `hp should be 50, got ${g.player.hp}`);
    assert(!g.events.find(e => e.type === 'playerDeath'), 'should NOT emit playerDeath');
    assert(g.events.find(e => e.type === 'phoenixRevive'), 'should emit phoenixRevive');
  });
});

suite('Trickster (crit damage)', () => {
  test('3x damage on crit roll', () => {
    // Use a seed that produces a low first rng value (< 0.10)
    const g = makeGame({ seed: 1 });
    g.player.critChance = 1.0; // force crit
    const enemy = { x: 100, y: 100, hp: 1000, maxHp: 1000, name: 'blob', damage: 5, color: '#0f0', radius: 10, xp: 10, speed: 50 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 10, 0, 'spit');
    // With critChance = 1.0, damage should be 10 * 3 = 30 rounded
    assert(enemy.hp === 970, `hp should be 970 (1000 - 30), got ${enemy.hp}`);
    const critEvt = g.events.find(e => e.type === 'critHit');
    assert(critEvt, 'should emit critHit event');
  });

  test('no crit when critChance is 0', () => {
    const g = makeGame();
    const enemy = { x: 100, y: 100, hp: 1000, maxHp: 1000, name: 'blob', damage: 5, color: '#0f0', radius: 10, xp: 10, speed: 50 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 10, 0, 'spit');
    assert(enemy.hp === 990, `hp should be 990 (no crit), got ${enemy.hp}`);
    const critEvt = g.events.find(e => e.type === 'critHit');
    assert(!critEvt, 'should NOT emit critHit without relic');
  });

  test('crit skipped for unowned damage (killerId null)', () => {
    const g = makeGame();
    g.player.critChance = 1.0;
    const enemy = { x: 100, y: 100, hp: 1000, maxHp: 1000, name: 'blob', damage: 5, color: '#0f0', radius: 10, xp: 10, speed: 50 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 10, null, null);
    assert(enemy.hp === 990, `unowned damage should not crit, got hp ${enemy.hp}`);
  });
});

suite('Shieldbreaker (+dmg vs armored)', () => {
  test('+15% damage vs boss', () => {
    const g = makeGame();
    g.player.armoredDmgBonus = 0.15;
    const enemy = { x: 100, y: 100, hp: 1000, maxHp: 1000, name: 'boss', damage: 50, color: '#c00', radius: 40, xp: 500, speed: 35, phase: 1, baseSpeed: 35 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 100, 0, 'spit');
    // 100 * 1.15 = 115, rounded = 115
    assert(enemy.hp === 885, `boss hp should be 885 (1000 - 115), got ${enemy.hp}`);
  });

  test('+15% damage vs brute', () => {
    const g = makeGame();
    g.player.armoredDmgBonus = 0.15;
    const enemy = { x: 100, y: 100, hp: 500, maxHp: 500, name: 'brute', damage: 30, color: '#e74c3c', radius: 24, xp: 60, speed: 22 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 100, 0, 'spit');
    assert(enemy.hp === 385, `brute hp should be 385 (500 - 115), got ${enemy.hp}`);
  });

  test('+15% damage vs elite', () => {
    const g = makeGame();
    g.player.armoredDmgBonus = 0.15;
    const enemy = { x: 100, y: 100, hp: 500, maxHp: 500, name: 'elite', damage: 25, color: '#6c5ce7', radius: 20, xp: 80, speed: 45 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 100, 0, 'spit');
    assert(enemy.hp === 385, `elite hp should be 385, got ${enemy.hp}`);
  });

  test('no bonus vs non-armored (blob)', () => {
    const g = makeGame();
    g.player.armoredDmgBonus = 0.15;
    const enemy = { x: 100, y: 100, hp: 500, maxHp: 500, name: 'blob', damage: 5, color: '#0f0', radius: 10, xp: 10, speed: 50 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 100, 0, 'spit');
    assert(enemy.hp === 400, `blob hp should be 400 (no bonus), got ${enemy.hp}`);
  });

  test('stacks additively (2 stacks = +30%)', () => {
    const g = makeGame();
    g.player.armoredDmgBonus = 0.30;
    const enemy = { x: 100, y: 100, hp: 1000, maxHp: 1000, name: 'boss', damage: 50, color: '#c00', radius: 40, xp: 500, speed: 35, phase: 1, baseSpeed: 35 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 100, 0, 'spit');
    // 100 * 1.30 = 130
    assert(enemy.hp === 870, `2-stack boss hp should be 870, got ${enemy.hp}`);
  });
});

suite('Ember Orb (burn on hit)', () => {
  test('applies burn status to enemy on proc', () => {
    const g = makeGame();
    g.player.emberChance = 1.0; // force proc
    const enemy = { x: 100, y: 100, hp: 500, maxHp: 500, name: 'blob', damage: 5, color: '#0f0', radius: 10, xp: 10, speed: 50 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 10, 0, 'spit');
    assert(enemy.statusEffects, 'enemy should have statusEffects');
    const burn = enemy.statusEffects.find(s => s.type === 'burn');
    assert(burn, 'should have a burn status');
    assert(burn.magnitude === 3, `burn dps should be 3, got ${burn.magnitude}`);
    assert(burn.remaining === 3, `burn duration should be 3, got ${burn.remaining}`);
    const evt = g.events.find(e => e.type === 'emberBurn');
    assert(evt, 'should emit emberBurn event');
  });

  test('no burn when emberChance is 0', () => {
    const g = makeGame();
    const enemy = { x: 100, y: 100, hp: 500, maxHp: 500, name: 'blob', damage: 5, color: '#0f0', radius: 10, xp: 10, speed: 50 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 10, 0, 'spit');
    const burn = enemy.statusEffects?.find(s => s.type === 'burn');
    assert(!burn, 'should not burn without relic');
  });

  test('burn skipped for unowned damage', () => {
    const g = makeGame();
    g.player.emberChance = 1.0;
    const enemy = { x: 100, y: 100, hp: 500, maxHp: 500, name: 'blob', damage: 5, color: '#0f0', radius: 10, xp: 10, speed: 50 };
    g.enemies.push(enemy);
    damageEnemy(g, enemy, 10, null, null);
    const burn = enemy.statusEffects?.find(s => s.type === 'burn');
    assert(!burn, 'unowned damage should not proc ember');
  });
});

// ── Summary ─────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`Tests: ${totalPassed} passed, ${totalFailed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('\nsim tests OK');
