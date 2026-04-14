// Projectile movement, range cleanup, and enemy collision. Pure sim;
// damage application + side-effects route through damage.js + events.
// Damage multi comes from the projectile's owner (set at fire time).
import { damageEnemy } from './damage.js';

export function updateProjectiles(g, dt) {
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const proj = g.projectiles[i];
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    proj.dist += proj.speed * dt;

    if (proj.dist > proj.range) {
      g.projectiles.splice(i, 1);
      continue;
    }

    for (let j = g.enemies.length - 1; j >= 0; j--) {
      const e = g.enemies[j];
      const edx = proj.x - e.x;
      const edy = proj.y - e.y;
      if (edx * edx + edy * edy < (proj.radius + e.radius) ** 2) {
        const owner = g.players.find(p => p.id === proj.owner);
        const dmgMulti = owner ? owner.damageMulti : 1;
        damageEnemy(g, e, j, proj.damage * dmgMulti, proj.owner);
        proj.pierce--;
        if (proj.pierce <= 0) {
          g.projectiles.splice(i, 1);
          break;
        }
      }
    }
  }
}
