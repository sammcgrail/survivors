// Projectile movement, range cleanup, enemy collision, and obstacle
// blocking. Pure sim; damage routes through damage.js + events.
import { damageEnemy } from './damage.js';
import { applyStatus } from './enemies.js';
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

    // Look up owner once per projectile, not per enemy collision.
    const owner = g.players.find(p => p.id === proj.owner);
    const dmg = proj.damage * (owner ? owner.damageMulti : 1);

    for (let j = g.enemies.length - 1; j >= 0; j--) {
      const e = g.enemies[j];
      // Skip enemies this projectile has already hit — otherwise a
      // fast projectile burns one pierce per frame while overlapping
      // a single big enemy (tank/boss), so pierce never actually
      // reaches enemies behind the first target. Reported by
      // barronn85 in #playtest. proj.hit is allocated lazily — most
      // projectiles never need it (pierce 1 dies on first contact).
      if (proj.hit && proj.hit.has(e)) continue;
      const edx = proj.x - e.x;
      const edy = proj.y - e.y;
      if (edx * edx + edy * edy < (proj.radius + e.radius) ** 2) {
        damageEnemy(g, e, dmg, proj.owner);
        if (proj.statusOnHit) applyStatus(g, e, proj.statusOnHit);
        proj.pierce--;
        if (proj.pierce <= 0) {
          g.projectiles.splice(i, 1);
          break;
        }
        if (!proj.hit) proj.hit = new Set();
        proj.hit.add(e);
      }
    }
  }
}
