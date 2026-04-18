// Projectile movement, range cleanup, and obstacle blocking.
// Enemy collision is handled by checkBulletEnemyCollisions in collision.js,
// called from tick.js with a shared spatial hash after this function runs.
import { circleRectCollision } from './collision.js';
import { PROJECTILE_BLOCKERS } from '../maps.js';

// Apply per-owner stat modifiers to a freshly-spawned projectile (once).
// Unified stat semantics (requested feature):
//   - projectileBonus → +bounces on every projectile (weapons that already
//     use projectileBonus for multi-shot spread get bonus bounces on top)
//   - sizeMulti → scales projectile hitbox radius
// Marked with _stats=true so we only do the normalize pass once per proj.
function normalizeProjectile(g, proj) {
  proj._stats = true;
  if (proj.bounces === undefined) proj.bounces = 0;
  if (!g.players || proj.owner === undefined) return;
  let owner = null;
  for (const pl of g.players) {
    if (pl.id === proj.owner) { owner = pl; break; }
  }
  if (!owner) return;
  proj.bounces += (owner.projectileBonus || 0);
  const sizeMulti = owner.sizeMulti || 1;
  if (sizeMulti !== 1) proj.radius *= sizeMulti;
}

// Reflect a projectile's velocity off a rect obstacle.
// Picks the flip axis by comparing the projectile's relative position
// to the obstacle center — shallowest penetration axis wins.
function reflectOffRect(proj, obs, dt) {
  const ox = obs.x + obs.w * 0.5;
  const oy = obs.y + obs.h * 0.5;
  const relX = (proj.x - ox) / (obs.w * 0.5);
  const relY = (proj.y - oy) / (obs.h * 0.5);
  if (Math.abs(relX) > Math.abs(relY)) {
    proj.vx = -proj.vx;
  } else {
    proj.vy = -proj.vy;
  }
  // Push projectile outside the obstacle so next tick isn't still inside.
  proj.x += proj.vx * dt * 2;
  proj.y += proj.vy * dt * 2;
}

export function updateProjectiles(g, dt) {
  const obstacles = g.obstacles;
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const proj = g.projectiles[i];
    if (!proj._stats) normalizeProjectile(g, proj);
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    proj.dist += proj.speed * dt;

    if (proj.dist > proj.range) {
      if (proj.bounces > 0) {
        // Out-of-range bounce: give it another full range to travel.
        // Cheap wraparound semantic — player builds with projectileBonus
        // get extra persistence without weird velocity math.
        proj.bounces--;
        proj.dist = 0;
        continue;
      }
      g.projectiles.splice(i, 1);
      continue;
    }

    // Wall / pillar / tomb absorb projectiles. Trees pass through.
    let blockedObs = null;
    if (obstacles && obstacles.length > 0) {
      for (const obs of obstacles) {
        if (!PROJECTILE_BLOCKERS.has(obs.type)) continue;
        if (circleRectCollision(proj.x, proj.y, proj.radius, obs.x, obs.y, obs.w, obs.h)) {
          blockedObs = obs;
          break;
        }
      }
    }
    if (blockedObs) {
      if (proj.bounces > 0) {
        proj.bounces--;
        reflectOffRect(proj, blockedObs, dt);
        continue;
      }
      g.projectiles.splice(i, 1);
      continue;
    }
  }
}
