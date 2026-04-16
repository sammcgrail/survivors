#!/usr/bin/env node
// CI performance regression harness — asserts sim throughput doesn't backslide.
// Runs 600 ticks at wave-25 density (~300 enemies) with a max-evo weapon loadout,
// measures per-tick wall-clock time, and hard-fails if p95 > 5ms or particles
// exceed the MAX_PARTICLES cap (with slack for the overflow mechanism).
//
// Run with: node tests/perf_bench.mjs
import { tickSim } from '../src/shared/sim/tick.js';
import { createRng } from '../src/shared/sim/rng.js';
import { createWeapon } from '../src/shared/weapons.js';
import {
  WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP,
  XP_MAGNET_RANGE, MAX_PARTICLES,
} from '../src/shared/constants.js';

// --- Thresholds ---
const P95_LIMIT_MS      = 5;
// NOTE: particles are populated client-side via applySimEvent (not by tickSim),
// so particle_hwm is 0 in headless. The assertion guards against future
// refactors that accidentally start pushing particles from the sim path.
const PARTICLE_HWM_LIMIT = MAX_PARTICLES + 50; // 650: slack for the shift-evict overflow path

// --- Config ---
const WARMUP_TICKS = 600; // fill enemy density before measuring (10s game time)
const BENCH_TICKS  = 600; // ticks to measure (10s game time at 60fps)
const dt           = 1 / 60;

function makeGame() {
  const player = {
    id: 0, x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0,
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
    radius: PLAYER_RADIUS, speed: PLAYER_SPEED,
    damageMulti: 1, attackSpeedMulti: 1, hpRegen: 0,
    magnetRange: XP_MAGNET_RANGE,
    xp: 0, xpToLevel: 45, level: 1, kills: 0, score: 0,
    // max-evo loadout: four evolved weapons for peak particle + spatial-hash stress
    weapons: [
      createWeapon('void_anchor'),
      createWeapon('fortress'),
      createWeapon('tesla_aegis'),
      createWeapon('dragon_storm'),
    ],
    alive: true, iframes: 0, facing: { x: 1, y: 0 },
  };
  return {
    player,
    players: [player],
    enemies: [], projectiles: [], gems: [], heartDrops: [], consumables: [], enemyProjectiles: [],
    particles: [], floatingTexts: [], deathFeed: [],
    chainEffects: [], meteorEffects: [],
    // wave 25: maxEnemies = 80 + 25*10 = 330, spawnRate capped at 0.3
    time: 0, wave: 25, waveTimer: 0, waveDuration: 20,
    spawnTimer: 0, spawnRate: 0.3,
    specialWaveMsg: null, specialWaveMsgTimer: 0,
    waveMsg: '', waveMsgTimer: 0,
    kills: 0, playerName: 'bench',
    camera: { x: WORLD_W / 2, y: WORLD_H / 2 }, screenShake: 0,
    events: [], rng: createRng(42),
    arena: { w: WORLD_W, h: WORLD_H },
  };
}

/** Return the p-th percentile of a sorted Float64Array. */
function pct(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// --- Warmup: fill enemy density without recording ---
const g = makeGame();
for (let i = 0; i < WARMUP_TICKS; i++) {
  tickSim(g, dt);
  g.time += dt;
  g.waveTimer += dt;
}

console.log(`bench setup: wave=${g.wave}, enemies=${g.enemies.length}, weapons=void_anchor+fortress+tesla_aegis+dragon_storm`);

// --- Measured run ---
const tickTimes = new Float64Array(BENCH_TICKS);
let particleHWM = 0;

for (let i = 0; i < BENCH_TICKS; i++) {
  const t0 = performance.now();
  tickSim(g, dt);
  tickTimes[i] = performance.now() - t0;
  g.time += dt;
  g.waveTimer += dt;
  if (g.particles.length > particleHWM) particleHWM = g.particles.length;
}

// Sort in-place; Float64Array.sort() defaults to numeric order (unlike Array)
tickTimes.sort();
const p50 = pct(tickTimes, 50);
const p95 = pct(tickTimes, 95);
const p99 = pct(tickTimes, 99);
const max = tickTimes[BENCH_TICKS - 1];

// --- Assertions ---
let failed = false;

if (p95 > P95_LIMIT_MS) {
  console.error(`FAIL  p95=${p95.toFixed(2)}ms > limit ${P95_LIMIT_MS}ms`);
  failed = true;
}

if (particleHWM >= PARTICLE_HWM_LIMIT) {
  console.error(`FAIL  particle_hwm=${particleHWM} >= limit ${PARTICLE_HWM_LIMIT} (MAX_PARTICLES=${MAX_PARTICLES})`);
  failed = true;
}

if (failed) process.exit(1);

console.log(`perf ok: p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms, max=${max.toFixed(2)}ms, particle_hwm=${particleHWM}`);
