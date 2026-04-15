#!/usr/bin/env node
// Headless sim smoke test — proves shared/sim/ runs end-to-end with no
// browser, no DOM, no canvas. Builds a minimal game state, ticks for
// ~10 seconds of game time, and asserts the sim produced kills + events.
//
// Run with: node tests/sim_smoke.mjs
import { tickSim } from '../src/shared/sim/tick.js';
import { createRng } from '../src/shared/sim/rng.js';
import { createWeapon } from '../src/shared/weapons.js';
import {
  WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP, XP_MAGNET_RANGE,
} from '../src/shared/constants.js';

function makeGame(seed = 42) {
  const player = {
    id: 0, x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0,
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
    radius: PLAYER_RADIUS, speed: PLAYER_SPEED,
    damageMulti: 1, attackSpeedMulti: 1, hpRegen: 0,
    magnetRange: XP_MAGNET_RANGE,
    xp: 0, xpToLevel: 45, level: 1, kills: 0, score: 0,
    // give the smoke run two weapons so we exercise multiple sim paths
    weapons: [createWeapon('spit'), createWeapon('orbit')],
    alive: true, iframes: 0, facing: { x: 1, y: 0 },
  };
  return {
    player,
    players: [player],
    enemies: [], projectiles: [], gems: [], heartDrops: [], consumables: [],
    particles: [], floatingTexts: [], deathFeed: [],
    chainEffects: [], meteorEffects: [],
    time: 0, wave: 1, waveTimer: 0, waveDuration: 20,
    spawnTimer: 0, spawnRate: 2.0,
    specialWaveMsg: null, specialWaveMsgTimer: 0,
    waveMsg: '', waveMsgTimer: 0,
    kills: 0, playerName: 'smoke',
    camera: { x: WORLD_W / 2, y: WORLD_H / 2 }, screenShake: 0,
    events: [], rng: createRng(seed),
  };
}

const g = makeGame();
const dt = 1 / 60;
const TICKS = 600; // 10 seconds

const start = Date.now();
for (let i = 0; i < TICKS; i++) {
  tickSim(g, dt);
  g.time += dt;
  g.waveTimer += dt;
}
const ms = Date.now() - start;

const eventCounts = {};
for (const e of g.events) eventCounts[e.type] = (eventCounts[e.type] || 0) + 1;

console.log(`tick smoke (seed=42, ${TICKS} ticks in ${ms}ms):`);
console.log(`  enemies alive : ${g.enemies.length}`);
console.log(`  projectiles   : ${g.projectiles.length}`);
console.log(`  gems on field : ${g.gems.length}`);
console.log(`  wave          : ${g.wave}`);
console.log(`  kills         : ${g.kills}`);
console.log(`  hp            : ${g.player.hp.toFixed(1)} / ${g.player.maxHp}`);
console.log(`  events queued : ${g.events.length}`);
console.log(`  event types   : ${JSON.stringify(eventCounts)}`);

let failed = false;
function check(cond, msg) {
  if (cond) { console.log(`  ok    ${msg}`); return; }
  console.error(`  FAIL  ${msg}`);
  failed = true;
}
check(g.enemies.length > 0, 'sim spawned enemies');
check(g.kills > 0, 'sim killed at least one enemy (weapons fired + collided)');
check(g.events.length > 0, 'sim emitted events');
check(eventCounts.weaponFire > 0, 'WEAPON_FIRE events emitted');
check(eventCounts.enemyKilled > 0, 'ENEMY_KILLED events emitted');
check(g.player.alive, 'player survived 10s smoke run');

if (failed) process.exit(1);
console.log('\nsim smoke OK');
