// Projectile movement, range cleanup, and obstacle blocking.
// Enemy collision is handled by checkBulletEnemyCollisions in collision.js,
// called from tick.js with a shared spatial hash after this function runs.
import { circleRectCollision } from './collision.js';
import { PROJECTILE_BLOCKERS } from '../maps.js';

export function updateProjectiles(g, dt) {
  const obstacles = g.obstacles;
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const proj = g.projectiles[i];
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    proj.dist += proj.speed * dt;

    if (proj.dist > proj.range) {
      g.projectiles.splice(i, 1);
      continue;
    }

    // Wall / pillar / tomb absorb projectiles. Trees pass through.
    let blocked = false;
    if (obstacles && obstacles.length > 0) {
      for (const obs of obstacles) {
        if (!PROJECTILE_BLOCKERS.has(obs.type)) continue;
        if (circleRectCollision(proj.x, proj.y, proj.radius, obs.x, obs.y, obs.w, obs.h)) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) {
      g.projectiles.splice(i, 1);
      continue;
    }
  }
}
