// Projectile movement, range cleanup, and enemy collision. Pure sim;
// damage application + side-effects route through damage.js + events.
import { damageEnemy } from './damage.js';

export function updateProjectiles(g, dt) {
  const p = g.player;
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const proj = g.projectiles[i];
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    proj.dist += proj.speed * dt;

    // remove if out of range
    if (proj.dist > proj.range) {
      g.projectiles.splice(i, 1);
      continue;
    }

    // hit enemies
    for (let j = g.enemies.length - 1; j >= 0; j--) {
      const e = g.enemies[j];
      const edx = proj.x - e.x;
      const edy = proj.y - e.y;
      if (edx * edx + edy * edy < (proj.radius + e.radius) ** 2) {
        damageEnemy(g, e, j, proj.damage * p.damageMulti);
        proj.pierce--;
        if (proj.pierce <= 0) {
          g.projectiles.splice(i, 1);
          break;
        }
      }
    }
  }
}
