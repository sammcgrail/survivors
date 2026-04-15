// Enemy spawn + per-tick update: movement (regular, ghost orbit, boss
// charge/stalk, spawner births), hit-flash decay, player-contact
// damage, spatial-hash repulsion. Pure sim — emits events for client
// side-effects (telegraph particles, hit sfx, screen shake, etc.).
import { ENEMY_TYPES, enemyType, scaleEnemy } from '../enemyTypes.js';
import { WORLD_W, WORLD_H } from '../constants.js';
import { EVT, emit } from './events.js';
import { pushOutOfObstacles, obstacleAvoidance } from './collision.js';

// Reusable zero vector for the no-obstacles path — saves an
// allocation per enemy per tick on maps without obstacles.
const ZERO_VEC = { x: 0, y: 0 };

// Cell size for the spatial hash. Sized to cover the largest flock
// perception radius (150 for fast/tank) within a 1-cell neighbor
// window — so each enemy's flock query scans at most 9 cells. Repulsion
// (max sum-of-radii ~48) easily fits in the same hash.
const HASH_CELL = 150;
const HASH_KEY_STRIDE = 100000;

function buildSpatialHash(enemies) {
  const cells = new Map();
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const cx = Math.floor(e.x / HASH_CELL);
    const cy = Math.floor(e.y / HASH_CELL);
    const k = cx * HASH_KEY_STRIDE + cy;
    let bucket = cells.get(k);
    if (!bucket) { bucket = []; cells.set(k, bucket); }
    bucket.push(i);
  }
  return cells;
}

// Pick a random alive player as the spawn anchor. Falls back to the
// world centre if everyone's dead (shouldn't happen — caller skips ticks
// when alive-list is empty — but safer than indexing []).
function spawnAnchor(g) {
  const alive = g.players.filter(p => p.alive);
  if (alive.length === 0) return { x: WORLD_W / 2, y: WORLD_H / 2 };
  return alive[g.rng.int(alive.length)];
}

export function spawnEnemy(g) {
  const anchor = spawnAnchor(g);
  const angle = g.rng.random() * Math.PI * 2;
  const dist = 500 + g.rng.random() * 200;
  const ex = anchor.x + Math.cos(angle) * dist;
  const ey = anchor.y + Math.sin(angle) * dist;
  const e = enemyType(g.wave, g.rng);
  const W = g.arena ? g.arena.w : WORLD_W;
  const H = g.arena ? g.arena.h : WORLD_H;
  e.x = Math.max(e.radius, Math.min(W - e.radius, ex));
  e.y = Math.max(e.radius, Math.min(H - e.radius, ey));
  // If we landed inside an obstacle, push out so the enemy doesn't
  // start its life clipped through a wall.
  if (g.obstacles && g.obstacles.length > 0) pushOutOfObstacles(e, g.obstacles);
  g.enemies.push(e);
}

// Returns the alive player with the smallest distance to (ex, ey), plus
// the dx/dy/dist back to that player. Returns null when no one is alive.
function nearestAlivePlayer(g, ex, ey) {
  let nearest = null, nearestD2 = Infinity;
  for (const p of g.players) {
    if (!p.alive) continue;
    const dx = p.x - ex, dy = p.y - ey;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestD2) { nearest = p; nearestD2 = d2; }
  }
  if (!nearest) return null;
  const dx = nearest.x - ex, dy = nearest.y - ey;
  return { p: nearest, dx, dy, dist: Math.sqrt(nearestD2) };
}

// Boss steps + telegraph use g.rng for cadence so server replay stays
// in sync. Ghost orbit and movement are deterministic given current pos.
function updateBossAi(g, e, dt, edx, edy, dist) {
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
  const inward = dist > 100 ? 0.8 : 1.0;
  const orbit = dist > 100 ? 0.6 : dist > 30 ? 0.3 : 0.1;
  e.x += (nx * inward + perpX * orbit) * e.speed * dt;
  e.y += (ny * inward + perpY * orbit) * e.speed * dt;
}

function updateSpawnerAi(g, e, dt) {
  e.spawnTimer -= dt;
  if (e.spawnTimer > 0) return;
  e.spawnTimer = 3 + g.rng.random() * 2;
  const count = 3 + Math.floor(g.rng.random() * 3); // 3-5 swarmlings
  for (let s = 0; s < count; s++) {
    const sa = g.rng.random() * Math.PI * 2;
    const sr = 20 + g.rng.random() * 20;
    const base = ENEMY_TYPES.find(t => t.name === 'swarm');
    const minion = scaleEnemy(base, g.wave, g.rng);
    minion.x = e.x + Math.cos(sa) * sr;
    minion.y = e.y + Math.sin(sa) * sr;
    g.enemies.push(minion);
  }
  emit(g, EVT.HIVE_BURST, { x: e.x, y: e.y });
}

// Boids steering: separation + alignment + cohesion vs same-type
// neighbors inside this enemy's flock perception radius. Reads from the
// pre-built spatial hash so we touch only ~9 cells per enemy. Returns
// the unweighted forces — caller blends with chase + chaseWeight.
function computeFlockSteering(g, hash, ei) {
  const e = g.enemies[ei];
  const fc = e.flock;
  const cx = Math.floor(e.x / HASH_CELL);
  const cy = Math.floor(e.y / HASH_CELL);
  const perR2 = fc.perceptionRadius * fc.perceptionRadius;
  const sepR2 = fc.sepRadius * fc.sepRadius;
  let sepX = 0, sepY = 0;
  let alignX = 0, alignY = 0;
  let cohX = 0, cohY = 0;
  let neighborCount = 0;
  for (let kx = -1; kx <= 1; kx++) {
    for (let ky = -1; ky <= 1; ky++) {
      const bucket = hash.get((cx + kx) * HASH_KEY_STRIDE + (cy + ky));
      if (!bucket) continue;
      for (let bi = 0; bi < bucket.length; bi++) {
        const j = bucket[bi];
        if (j === ei) continue;
        const o = g.enemies[j];
        if (o.name !== e.name || o.dying !== undefined) continue;
        const dx = e.x - o.x, dy = e.y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > perR2 || d2 < 0.01) continue;
        if (d2 < sepR2) {
          // Separation pushes harder the closer the neighbor is.
          const d = Math.sqrt(d2);
          sepX += dx / d;
          sepY += dy / d;
        }
        alignX += o.vx;
        alignY += o.vy;
        cohX += o.x - e.x;
        cohY += o.y - e.y;
        neighborCount++;
      }
    }
  }
  if (neighborCount > 0) {
    alignX /= neighborCount; alignY /= neighborCount;
    cohX /= neighborCount;   cohY /= neighborCount;
  }
  return { sepX, sepY, alignX, alignY, cohX, cohY };
}

// Per-enemy movement + AI + hit-flash decay + player contact. Movement
// + AI target the nearest alive player; contact damage hits any player
// the enemy actually overlaps. Dying enemies were removed in the
// pre-pass, so indices stay stable for the flock hash here.
function updateEnemyTick(g, dt, hash) {
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i];
    if (e.dying !== undefined) continue; // animating but not interacting

    // Stunned enemies freeze in place but still take damage. Thunder god
    // overcharge is the current source; any future CC rides the same hook.
    if (e.stunTimer > 0) {
      e.stunTimer -= dt;
    } else {
      const target = nearestAlivePlayer(g, e.x, e.y);
      if (target && target.dist > 1) {
        if (e.name === 'ghost')      updateGhostMovement(e, dt, target.dx, target.dy, target.dist);
        else if (e.name === 'boss')  updateBossAi(g, e, dt, target.dx, target.dy, target.dist);
        else if (!e.flock) {
          // Fallback for any type without flock config — pure chase.
          e.x += (target.dx / target.dist) * e.speed * dt;
          e.y += (target.dy / target.dist) * e.speed * dt;
        } else {
          // Boids blend: chase + separation + alignment + cohesion +
          // obstacle avoidance. Avoidance has a high implicit weight
          // because its raw vector is summed inverse-distance — close
          // walls dominate the steering, distant ones nudge softly.
          const fc = e.flock;
          const chaseX = target.dx / target.dist;
          const chaseY = target.dy / target.dist;
          const f = computeFlockSteering(g, hash, i);
          // Lookahead distance scales with speed so fast enemies see
          // further ahead and have room to steer. At 60u/s (blob) this
          // gives ~60u lookahead; at 130u/s (fast) ~110u — enough to
          // turn around corners instead of overshooting.
          const avoid = g.obstacles && g.obstacles.length > 0
            ? obstacleAvoidance(e.x, e.y, e.vx, e.vy, g.obstacles, e.radius + e.speed * 0.8)
            : ZERO_VEC;
          let vx = chaseX * fc.chaseWeight
                 + f.sepX * fc.sepWeight
                 + f.alignX * fc.alignWeight
                 + f.cohX * fc.cohWeight
                 + avoid.x * 5.0;
          let vy = chaseY * fc.chaseWeight
                 + f.sepY * fc.sepWeight
                 + f.alignY * fc.alignWeight
                 + f.cohY * fc.cohWeight
                 + avoid.y * 5.0;
          const m = Math.hypot(vx, vy);
          if (m > 0.001) {
            e.vx = (vx / m) * e.speed;
            e.vy = (vy / m) * e.speed;
          } else {
            // Forces canceled exactly — fall back to chase so the enemy
            // doesn't freeze in place.
            e.vx = chaseX * e.speed;
            e.vy = chaseY * e.speed;
          }
          e.x += e.vx * dt;
          e.y += e.vy * dt;
        }
      }
    }

    // Push enemies out of obstacles — naturally creates "pathfinding"
    // as they slide along walls toward the target.
    if (g.obstacles && g.obstacles.length > 0) pushOutOfObstacles(e, g.obstacles);

    // Spawner births minions on a timer — gated by stun so a stunned
    // hive doesn't keep pumping out swarmlings during the freeze.
    if (e.name === 'spawner' && (!e.stunTimer || e.stunTimer <= 0)) updateSpawnerAi(g, e, dt);

    if (e.hitFlash > 0) e.hitFlash -= dt * 5;

    // Contact damage — hit every overlapping alive player (not just nearest).
    for (const p of g.players) {
      if (!p.alive || p.iframes > 0) continue;
      const dx = p.x - e.x, dy = p.y - e.y;
      if (dx * dx + dy * dy < (p.radius + e.radius) ** 2) {
        const dmg = Math.max(1, e.damage - (p.armor || 0));
        p.hp -= dmg;
        p.iframes = 0.5;
        emit(g, EVT.PLAYER_HIT, { x: p.x, y: p.y, dmg, by: e.name, pid: p.id });
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          emit(g, EVT.PLAYER_DEATH, { by: e.name, pid: p.id });
        }
      }
    }
  }
}

// Pass 2: hard overlap correction. Per-type separation in the flock pass
// already keeps enemies spaced at preferred distances; this pass only
// fires when sprites actually overlap (sum-of-radii) to prevent visual
// stacking. Builds its own hash post-movement.
function updateRepulsion(g) {
  const hash = buildSpatialHash(g.enemies);
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    const cx = Math.floor(e.x / HASH_CELL);
    const cy = Math.floor(e.y / HASH_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = hash.get((cx + dx) * HASH_KEY_STRIDE + (cy + dy));
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
  // Pre-pass: progress death animations + remove finished ones BEFORE
  // building the hash so the flock pass sees stable indices (no
  // mid-tick splices invalidating the bucket index lists).
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i];
    if (e.dying === undefined) continue;
    e.dying -= dt;
    if (e.dying <= 0) g.enemies.splice(i, 1);
  }
  const hash = buildSpatialHash(g.enemies);
  updateEnemyTick(g, dt, hash);
  updateRepulsion(g);
  // Final push-out pass: enemy-vs-enemy repulsion can shove neighbors
  // sideways into walls, so we re-correct after. Without this an enemy
  // packed against a wall by its flockmates ends each tick stuck
  // inside the obstacle.
  if (g.obstacles && g.obstacles.length > 0) {
    for (const e of g.enemies) {
      if (e.dying === undefined) pushOutOfObstacles(e, g.obstacles);
    }
  }
}
