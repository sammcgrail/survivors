#!/usr/bin/env node
// Weapon DPS bench — equips one weapon at a time, runs 30s at a given
// wave with steady enemy spawns, and reports observed damage-per-second
// derived from EVT.ENEMY_HIT events. Pure sim (no browser, no DOM) so
// it's fast: the full 14×5 sweep completes in a few seconds.
//
// Runs in two modes:
//   node tests/weapon_bench.mjs                    # 14 weapons × 5 waves
//   node tests/weapon_bench.mjs --csv              # CSV output
//   node tests/weapon_bench.mjs --weapon=spit      # single weapon sweep
//   node tests/weapon_bench.mjs --wave=10          # single wave sweep
//
// DPS math: sum of enemyHit.dmg events over run duration. Does NOT
// include DoT-pending damage still ticking when the run ends — negligible
// at 30s. Averages over N_RUNS (default 3) to smooth rng variance.

import { tickSim } from '../src/shared/sim/tick.js';
import { createRng } from '../src/shared/sim/rng.js';
import { createWeapon } from '../src/shared/weapons.js';
import { EVT } from '../src/shared/sim/events.js';
import { ENEMY_TYPES, WAVE_POOLS, scaleEnemy } from '../src/shared/enemyTypes.js';
import {
  WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP, XP_MAGNET_RANGE,
} from '../src/shared/constants.js';

// Expected average enemy HP at a given wave — weighted by the spawn
// pool for that wave bracket. Used to convert kill counts into
// damage-equivalent DPS for sustained-DoT weapons that don't emit
// per-hit events (damage.js suppresses emit when dmg < 5).
function avgEnemyHpAtWave(wave) {
  const pool = WAVE_POOLS.find(p => wave <= p.maxWave) || WAVE_POOLS[WAVE_POOLS.length - 1];
  const entries = Object.entries(pool.weights);
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  let weightedHp = 0;
  const rng = { random: () => 0.5, int: () => 0 };
  for (const [name, weight] of entries) {
    const base = ENEMY_TYPES.find(t => t.name === name);
    if (!base) continue;
    const scaled = scaleEnemy(base, wave, rng);
    weightedHp += scaled.maxHp * (weight / totalWeight);
  }
  return weightedHp;
}

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const CSV = !!args.csv;
const N_RUNS = Number(args.runs ?? 3);
const DURATION = Number(args.duration ?? 30);

const ALL_WEAPONS = [
  'spit', 'breath', 'charge', 'orbit', 'chain', 'meteor', 'shield', 'lightning_field',
  'dragon_storm', 'thunder_god', 'meteor_orbit', 'fortress',
  'inferno_wheel', 'tesla_aegis',
];
// Test on non-SPECIAL_WAVES so all weapons face the same pool composition.
// Wave 20 is THE DEMON (single boss w/ 10k hp), which starves non-AOE
// weapons of targets — so stop at 18 and let the late-game sample cover
// that. Waves 6/7/9/11/13/15/17/19 are special too but 15 (THE HORDE)
// is intentionally included: dense crowd clear is exactly when we want
// to see how weapons behave, and it's the same pool for everyone.
const ALL_WAVES = [1, 5, 10, 15, 18];

const WEAPONS = args.weapon ? [args.weapon] : ALL_WEAPONS;
const WAVES = args.wave ? [Number(args.wave)] : ALL_WAVES;

function makePlayer(weapon) {
  return {
    id: 0, x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0,
    hp: 999999, maxHp: 999999,
    radius: PLAYER_RADIUS, speed: PLAYER_SPEED,
    damageMulti: 1, attackSpeedMulti: 1, hpRegen: 0,
    magnetRange: XP_MAGNET_RANGE,
    projectileBonus: 0, sizeMulti: 1, armor: 0,
    xp: 0, xpToLevel: 999999, level: 1, kills: 0, score: 0,
    weapons: [createWeapon(weapon)],
    alive: true, iframes: 0, facing: { x: 1, y: 0 },
    powerupStacks: { ['weapon_' + weapon]: 1 },
  };
}

function makeGame(weapon, wave, seed) {
  const player = makePlayer(weapon);
  return {
    player,
    players: [player],
    enemies: [], projectiles: [], gems: [], heartDrops: [], consumables: [],
    enemyProjectiles: [],
    particles: [], floatingTexts: [], deathFeed: [],
    chainEffects: [], meteorEffects: [], chargeTrails: [],
    time: 0,
    // `wave` is pinned to the target bracket for the whole run; we want
    // to measure DPS against wave-N enemies, not enemies that scale up
    // mid-run when the wave timer ticks over.
    wave, waveTimer: 0, waveDuration: 999999,
    spawnTimer: 0, spawnRate: 0.5,
    specialWaveMsg: null, specialWaveMsgTimer: 0,
    waveMsg: '', waveMsgTimer: 0,
    kills: 0, playerName: 'bench',
    camera: { x: player.x, y: player.y }, screenShake: 0,
    events: [], rng: createRng(seed),
    arena: { w: WORLD_W, h: WORLD_H },
    obstacles: [],
  };
}

function benchOne(weapon, wave, seed, avgHp) {
  const g = makeGame(weapon, wave, seed);
  const dt = 1 / 60;
  const steps = DURATION * 60;
  let kills = 0;
  for (let i = 0; i < steps; i++) {
    tickSim(g, dt);
    g.time += dt;
    for (const ev of g.events) {
      if (ev.type === 'enemyKilled') kills++;
    }
    g.events.length = 0;
  }
  // Also account for damage to still-alive + dying enemies at the end
  // of the run — keeps sustained-DoT weapons from being undercounted
  // when they can't quite finish a crowd before the clock expires.
  let pendingDmg = 0;
  for (const e of g.enemies) {
    if (e.dying !== undefined) continue;
    pendingDmg += (e.maxHp - e.hp);
  }
  const totalDmg = kills * avgHp + pendingDmg;
  return { dmg: totalDmg, dps: totalDmg / DURATION, kills };
}

function benchAverage(weapon, wave) {
  const avgHp = avgEnemyHpAtWave(wave);
  let dps = 0, kills = 0;
  for (let i = 0; i < N_RUNS; i++) {
    const r = benchOne(weapon, wave, 1000 + i * 17, avgHp);
    dps += r.dps; kills += r.kills;
  }
  return { dps: dps / N_RUNS, kills: kills / N_RUNS };
}

console.error(`[bench] ${WEAPONS.length} weapons × ${WAVES.length} waves × ${N_RUNS} runs × ${DURATION}s ...`);

const rows = [];
for (const w of WEAPONS) {
  const row = { weapon: w };
  for (const wave of WAVES) {
    const r = benchAverage(w, wave);
    row[`w${wave}`] = r.dps;
    row[`w${wave}_kills`] = r.kills;
  }
  rows.push(row);
}

if (CSV) {
  const cols = ['weapon', ...WAVES.flatMap(w => [`w${w}_dps`, `w${w}_kills`])];
  console.log(cols.join(','));
  for (const r of rows) {
    const vals = ['weapon', ...WAVES.flatMap(w => [`w${w}`, `w${w}_kills`])]
      .map(c => c === 'weapon' ? r.weapon : (r[c] ?? 0).toFixed(1));
    console.log(vals.join(','));
  }
} else {
  // Pretty table — weapon, then one column per wave of DPS. kills in ().
  const nameW = Math.max(...WEAPONS.map(w => w.length), 10);
  const header = ['weapon'.padEnd(nameW), ...WAVES.map(w => `w${w}`.padStart(14))].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    const cells = [r.weapon.padEnd(nameW)];
    for (const w of WAVES) {
      const dps = r[`w${w}`] || 0;
      const k = r[`w${w}_kills`] || 0;
      cells.push(`${dps.toFixed(0).padStart(6)} (${k.toFixed(0).padStart(3)}k)`);
    }
    console.log(cells.join(' '));
  }
  console.log();
  // Outlier summary — rank by total DPS across all tested waves.
  const ranked = [...rows].sort((a, b) => {
    const ta = WAVES.reduce((s, w) => s + (a[`w${w}`] || 0), 0);
    const tb = WAVES.reduce((s, w) => s + (b[`w${w}`] || 0), 0);
    return tb - ta;
  });
  console.log('total DPS rank (summed across tested waves):');
  for (const r of ranked) {
    const total = WAVES.reduce((s, w) => s + (r[`w${w}`] || 0), 0);
    console.log(`  ${r.weapon.padEnd(nameW)} ${total.toFixed(0).padStart(8)}`);
  }
}
