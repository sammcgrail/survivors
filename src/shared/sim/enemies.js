// Enemy spawn + per-tick update: movement (regular, ghost orbit, boss
// charge/stalk, spawner births), hit-flash decay, player-contact
// damage, spatial-hash repulsion. Pure sim — emits events for client
// side-effects (telegraph particles, hit sfx, screen shake, etc.).
import { ENEMY_TYPES, enemyType, scaleEnemy } from '../enemyTypes.js';
import { WORLD_W, WORLD_H } from '../constants.js';
import { EVT, emit } from './events.js';

// Cell size for the spatial hash. Brute is largest enemy at radius 24,
// so 50u keeps any colliding pair within own cell + 1 neighbor.
const HASH_CELL = 50;

export function spawnEnemy(g) {
  const angle = g.rng.random() * Math.PI * 2;
  const dist = 500 + g.rng.random() * 200;
  const ex = g.player.x + Math.cos(angle) * dist;
  const ey = g.player.y + Math.sin(angle) * dist;
  const e = enemyType(g.wave);
  e.x = Math.max(e.radius, Math.min(WORLD_W - e.radius, ex));
  e.y = Math.max(e.radius, Math.min(WORLD_H - e.radius, ey));
  e.hitFlash = 0;
  g.enemies.push(e);
}

// Boss steps + telegraph use g.rng for cadence so server replay stays
// in sync. Ghost orbit and movement are deterministic given current pos.
function updateBossAi(g, e, dt, edx, edy, dist) {
  if (e.chargeTimer === undefined) e.chargeTimer = 3 + g.rng.random() * 2;
  if (e.charging === undefined) e.charging = 0;
  if (e.charging > 0) {
    e.x += e.chargeDx * e.speed * 3 * dt;
    e.y += e.chargeDy * e.speed * 3 * dt;
    e.charging -= dt;
    return;
  }
  // stalking
  e.x += (edx / dist) * e.speed * 0.5 * dt;
  e.y += (edy / dist) * e.speed * 0.5 * dt;
  e.chargeTimer -= dt;
  if (e.stepTimer === undefined) e.stepTimer = 0.8;
  e.stepTimer -= dt;
  if (e.stepTimer <= 0 && dist < 500) {
    emit(g, EVT.BOSS_STEP, { x: e.x, y: e.y });
    e.stepTimer = 0.7 + g.rng.random() * 0.3;
  }
  if (e.chargeTimer <= 0 && dist < 400) {
    e.chargeDx = edx / dist;
    e.chargeDy = edy / dist;
    e.charging = 0.8;
    e.chargeTimer = 4 + g.rng.random() * 3;
    emit(g, EVT.BOSS_TELEGRAPH, { x: e.x, y: e.y });
  }
}

function updateGhostMovement(e, dt, edx, edy, dist) {
  const nx = edx / dist;
  const ny = edy / dist;
  const sign = e.orbitSign || 1;
  const perpX = -ny * sign;
  const perpY = nx * sign;
  // closing at range, committed up close, drive-by prevented at melee
  const inward = dist > 100 ? 0.8 : dist > 30 ? 1.0 : 1.0;
  const orbit = dist > 100 ? 0.6 : dist > 30 ? 0.3 : 0.1;
  e.x += (nx * inward + perpX * orbit) * e.speed * dt;
  e.y += (ny * inward + perpY * orbit) * e.speed * dt;
}

function updateSpawnerAi(g, e, dt) {
  if (e.spawnTimer === undefined) return;
  e.spawnTimer -= dt;
  if (e.spawnTimer > 0) return;
  e.spawnTimer = 3 + g.rng.random() * 2;
  const count = 3 + Math.floor(g.rng.random() * 3); // 3-5 swarmlings
  for (let s = 0; s < count; s++) {
    const sa = g.rng.random() * Math.PI * 2;
    const sr = 20 + g.rng.random() * 20;
    const base = ENEMY_TYPES.find(t => t.name === 'swarm');
    const minion = scaleEnemy(base, g.wave);
    minion.x = e.x + Math.cos(sa) * sr;
    minion.y = e.y + Math.sin(sa) * sr;
    minion.hitFlash = 0;
    g.enemies.push(minion);
  }
  emit(g, EVT.HIVE_BURST, { x: e.x, y: e.y });
}

// Pass 1: per-enemy movement + AI + hit-flash decay + player contact.
// Iterate backward because dying enemies splice from the array.
function updateEnemyTick(g, dt) {
  const p = g.player;
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i];

    // dying animation — shrink + fade then remove
    if (e.dying !== undefined) {
      e.dying -= dt;
      if (e.dying <= 0) g.enemies.splice(i, 1);
      continue;
    }

    const edx = p.x - e.x;
    const edy = p.y - e.y;
    const dist = Math.sqrt(edx * edx + edy * edy);

    if (dist > 1) {
      if (e.name === 'ghost')      updateGhostMovement(e, dt, edx, edy, dist);
      else if (e.name === 'boss')  updateBossAi(g, e, dt, edx, edy, dist);
      else {
        e.x += (edx / dist) * e.speed * dt;
        e.y += (edy / dist) * e.speed * dt;
      }
    }

    if (e.name === 'spawner') updateSpawnerAi(g, e, dt);

    if (e.hitFlash > 0) e.hitFlash -= dt * 5;

    // damage player on contact
    if (dist < p.radius + e.radius && p.iframes <= 0) {
      p.hp -= e.damage;
      p.iframes = 0.5;
      emit(g, EVT.PLAYER_HIT, { x: p.x, y: p.y, dmg: e.damage, by: e.name });
      if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
        emit(g, EVT.PLAYER_DEATH, { by: e.name });
      }
    }
  }
}

// Pass 2: enemy-enemy repulsion via spatial hash. Each enemy checks 9
// cells (own + neighbors) instead of all N. Drops cost from O(N²) to
// ~O(N) at typical densities.
function updateRepulsion(g) {
  const cells = new Map();
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    const cx = Math.floor(e.x / HASH_CELL);
    const cy = Math.floor(e.y / HASH_CELL);
    const k = cx * 100000 + cy; // numeric key avoids string interning
    let bucket = cells.get(k);
    if (!bucket) { bucket = []; cells.set(k, bucket); }
    bucket.push(i);
  }
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    const cx = Math.floor(e.x / HASH_CELL);
    const cy = Math.floor(e.y / HASH_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = cells.get((cx + dx) * 100000 + (cy + dy));
        if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const j = bucket[bi];
          if (j <= i) continue; // each pair handled once
          const e2 = g.enemies[j];
          const rx = e.x - e2.x;
          const ry = e.y - e2.y;
          const rd = Math.sqrt(rx * rx + ry * ry);
          const minD = e.radius + e2.radius;
          if (rd < minD && rd > 0.1) {
            const push = (minD - rd) * 0.5;
            const nx = rx / rd;
            const ny = ry / rd;
            e.x += nx * push;
            e.y += ny * push;
            e2.x -= nx * push;
            e2.y -= ny * push;
          }
        }
      }
    }
  }
}

export function updateEnemies(g, dt) {
  updateEnemyTick(g, dt);
  updateRepulsion(g);
}
