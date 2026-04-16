// Collision geometry (circle-vs-AABB) plus spatial-hash hit-checks for
// bullet-vs-enemy and player-vs-enemy contact. The hit-test functions live
// here so tick.js can build one hash per tick and share it between both passes.
//
// Circular-import note: checkBulletEnemyCollisions needs applyStatus from
// enemies.js, which itself imports the geometry helpers below. ESM live
// bindings make this safe — both imports are only used inside function
// bodies, never at module-init time.
import { damageEnemy } from './damage.js';
import { applyStatus } from './enemies.js';
import { EVT, emit } from './events.js';
import { applyPoisonToPlayer } from './playerStatus.js';

// Circle-vs-AABB collision used for player/enemy/projectile vs obstacle
// checks. Pure math — no game-state references, importable anywhere.
//
// `nearest` clamps the circle centre into the rect; the squared
// distance from there to the centre tells us if they overlap. Used
// by the maps system (src/shared/maps.js) when a tick updates a
// circular entity's position.

export function circleRectCollision(cx, cy, cr, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < cr * cr;
}

// When a circle is overlapping a rect, returns the {x, y} push vector
// to move the circle out (along the shortest path). Two cases:
// - Centre outside the rect: push along the line from nearest edge
//   point to centre (standard).
// - Centre inside the rect: pick the nearest of the four edges and
//   push perpendicular to it. Without this branch the entity would
//   stay trapped inside an obstacle whenever steering managed to
//   push the centre through the boundary on a single tick.
export function resolveCircleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= cr * cr) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    const push = cr - d;
    return { x: (dx / d) * push, y: (dy / d) * push };
  }
  // Centre inside the rect — pick the closest face.
  const dl = cx - rx, dr = (rx + rw) - cx;
  const dt = cy - ry, db = (ry + rh) - cy;
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return { x: -(dl + cr), y: 0 };
  if (m === dr) return { x: dr + cr, y: 0 };
  if (m === dt) return { x: 0, y: -(dt + cr) };
  return { x: 0, y: db + cr };
}

// Push a circle out of every obstacle in the list. Idempotent — call
// after every movement step. `pierces` → tree-style obstacles that
// don't block movement (caller filters before passing in).
export function pushOutOfObstacles(circle, obstacles) {
  for (const obs of obstacles) {
    const push = resolveCircleRect(circle.x, circle.y, circle.radius, obs.x, obs.y, obs.w, obs.h);
    if (push) { circle.x += push.x; circle.y += push.y; }
  }
}

// Steering force that routes a moving entity around obstacles.
//
// Works in two passes:
//   1. Find the strongest nearby obstacle ahead of us (closest /
//      largest overlap). Its geometry determines which side of the
//      velocity we steer toward — so when two obstacles meet at a
//      corner, we don't pick opposing sides that cancel to zero.
//   2. Sum perpendicular pushes for every obstacle within range,
//      all along the side chosen in pass 1, with linear falloff.
//
// Fallback: if no obstacle is "ahead" (forward component ≥ 0) but
// we're overlapping one (pushOut couldn't fully resolve in a single
// tick), we push straight backward along −velocity so the entity
// retreats rather than grinding against the rect.
export function obstacleAvoidance(x, y, vx, vy, obstacles, lookAhead) {
  const speed = Math.hypot(vx, vy);
  if (speed < 0.001) return { x: 0, y: 0 };
  const dx = vx / speed, dy = vy / speed;
  const perpX = -dy, perpY = dx;
  const lookAhead2 = lookAhead * lookAhead;

  // Pass 1 — find the strongest ahead obstacle to decide the steering side.
  let bestStrength = 0;
  let bestLateral = 0;
  let overlapping = false;
  for (const o of obstacles) {
    const nx = Math.max(o.x, Math.min(x, o.x + o.w));
    const ny = Math.max(o.y, Math.min(y, o.y + o.h));
    const rdx = nx - x, rdy = ny - y;
    const d2 = rdx * rdx + rdy * rdy;
    if (d2 < 0.0001) { overlapping = true; continue; }  // inside the rect
    const forward = rdx * dx + rdy * dy;
    if (forward <= 0) continue;                         // obstacle behind
    if (d2 >= lookAhead2) continue;
    const strength = 1 - Math.sqrt(d2) / lookAhead;
    if (strength > bestStrength) {
      bestStrength = strength;
      // Signed lateral offset of the entity *relative to the obstacle*
      // on the perpendicular axis. Using the rect centre keeps the
      // choice stable across the obstacle's whole face.
      bestLateral = perpX * (x - (o.x + o.w * 0.5)) + perpY * (y - (o.y + o.h * 0.5));
    }
  }

  // Overlapping and nothing "ahead" to route around: reverse course.
  if (bestStrength === 0) {
    return overlapping ? { x: -dx, y: -dy } : { x: 0, y: 0 };
  }

  // Pass 2 — accumulate perpendicular pushes, all on the same side.
  // `>= 0` bias: ties consistently pick +perp so enemies on the exact
  // midline of a thin rect don't flip-flop and clash.
  const sign = bestLateral >= 0 ? 1 : -1;
  let ax = 0, ay = 0;
  for (const o of obstacles) {
    const nx = Math.max(o.x, Math.min(x, o.x + o.w));
    const ny = Math.max(o.y, Math.min(y, o.y + o.h));
    const rdx = nx - x, rdy = ny - y;
    const d2 = rdx * rdx + rdy * rdy;
    if (d2 < 0.0001) continue;
    const forward = rdx * dx + rdy * dy;
    if (forward <= 0 || d2 >= lookAhead2) continue;
    const strength = 1 - Math.sqrt(d2) / lookAhead;
    ax += perpX * sign * strength;
    ay += perpY * sign * strength;
  }
  return { x: ax, y: ay };
}

// Spatial hash for circle-vs-circle proximity queries. Entities that share
// a cell (or are in adjacent cells) are collision candidates; distant
// entities are skipped entirely. Cell size matches the flock perception
// radius so 9-cell neighbor scans cover the full interaction range.
export const HASH_CELL = 150;
export const HASH_KEY_STRIDE = 100000;

// Builds a spatial hash over `entities` (keyed by (x, y) → bucket of
// entity refs). Also tags each entity with `_hidx = i` — a stable index
// into the input array for the duration of the tick. Callers doing
// symmetric pair-scans (e.g. enemy-vs-enemy repulsion) can use `_hidx`
// to dedup pairs without an O(N²) indexOf. Asymmetric callers
// (bullet→enemy, enemy→player) ignore the field. Next tick's hash
// build overwrites, so no cleanup is needed.
export function buildSpatialHash(entities) {
  const cells = new Map();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    e._hidx = i;
    const cx = Math.floor(e.x / HASH_CELL);
    const cy = Math.floor(e.y / HASH_CELL);
    const k = cx * HASH_KEY_STRIDE + cy;
    let bucket = cells.get(k);
    if (!bucket) { bucket = []; cells.set(k, bucket); }
    bucket.push(e);
  }
  return cells;
}

// ── Spatial-hash hit-tests ──────────────────────────────────────────────────
// Both functions accept a pre-built enemy hash (from buildSpatialHash) so
// tick.js can build it once and share it across both passes per tick.

// Apply a projectile hit: compute damage with owner's damageMulti, call
// damageEnemy, apply on-hit status, decrement pierce, register the enemy
// in proj.hit so it won't be struck again by this projectile on future frames.
function applyHit(g, s, e) {
  const owner = g.players.find(p => p.id === s.owner);
  const dmg = s.damage * (owner ? owner.damageMulti : 1);
  damageEnemy(g, e, dmg, s.owner);
  if (s.statusOnHit) applyStatus(g, e, s.statusOnHit);
  s.pierce--;
  if (!s.hit) s.hit = new Set();
  s.hit.add(e);
}

// Apply enemy contact damage: armor-reduced hit, set iframes 0.5s, emit
// PLAYER_HIT, apply poisoner DoT if any, handle death.
function applyContactDamage(g, e, p) {
  const dmg = Math.max(1, e.damage - (p.armor || 0));
  p.hp -= dmg;
  p.iframes = 0.5;
  emit(g, EVT.PLAYER_HIT, { x: p.x, y: p.y, dmg, by: e.name, pid: p.id });
  if (e.poisonOnHit) applyPoisonToPlayer(p, e.poisonOnHit.dps, e.poisonOnHit.duration);
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    emit(g, EVT.PLAYER_DEATH, { x: p.x, y: p.y, by: e.name, pid: p.id });
  }
}

// Bullet vs. enemy — O(shots × k) where k = enemies in 9 nearby cells.
// Iterating backwards allows safe splice when pierce hits 0.
// `seen` prevents double-testing enemies that span adjacent cells.
// `s.hit` (per-projectile Set) prevents re-hitting the same enemy on later
// frames while a piercing shot overlaps it — the original barronn85 fix.
export function checkBulletEnemyCollisions(g, enemyHash) {
  for (let si = g.projectiles.length - 1; si >= 0; si--) {
    const s = g.projectiles[si];
    const cx = Math.floor(s.x / HASH_CELL);
    const cy = Math.floor(s.y / HASH_CELL);
    const seen = new Set();
    let consumed = false;
    outer:
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = enemyHash.get((cx + dx) * HASH_KEY_STRIDE + (cy + dy));
        if (!cell) continue;
        for (const e of cell) {
          if (seen.has(e)) continue;
          seen.add(e);
          if (s.hit && s.hit.has(e)) continue;
          const ex = s.x - e.x, ey = s.y - e.y;
          if (ex * ex + ey * ey < (s.radius + e.radius) ** 2) {
            applyHit(g, s, e);
            if (s.pierce <= 0) { consumed = true; break outer; }
          }
        }
      }
    }
    if (consumed) g.projectiles.splice(si, 1);
  }
}

// Player vs. enemy — O(players × k). The `break outer` after the first hit
// sets iframes = 0.5, preventing a player from taking two hits in one tick
// from adjacent enemies — matches the original `p.iframes` guard behaviour.
export function checkEnemyPlayerCollisions(g, enemyHash) {
  for (const p of g.players) {
    if (!p.alive || p.iframes > 0) continue;
    const cx = Math.floor(p.x / HASH_CELL);
    const cy = Math.floor(p.y / HASH_CELL);
    outer:
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = enemyHash.get((cx + dx) * HASH_KEY_STRIDE + (cy + dy));
        if (!cell) continue;
        for (const e of cell) {
          if (e.dying !== undefined) continue;
          const ex = e.x - p.x, ey = e.y - p.y;
          if (ex * ex + ey * ey < (e.radius + p.radius) ** 2) {
            applyContactDamage(g, e, p);
            break outer;
          }
        }
      }
    }
  }
}
