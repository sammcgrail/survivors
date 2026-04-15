// Enemy projectile system — ranged attacks from elites + bosses.
// Separate from player projectiles so collision only checks players,
// not enemies. Obstacles block enemy shots the same way they block
// player shots.
import { EVT, emit } from './events.js';
import { circleRectCollision } from './collision.js';
import { PROJECTILE_BLOCKERS } from '../maps.js';

// Spawn a single enemy projectile aimed at (tx, ty) from (ox, oy).
export function fireEnemyProjectile(g, ox, oy, tx, ty, opts) {
  const dx = tx - ox, dy = ty - oy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) return;
  const nx = dx / d, ny = dy / d;
  const speed = opts.speed || 150;
  g.enemyProjectiles.push({
    x: ox, y: oy,
    vx: nx * speed, vy: ny * speed,
    speed,
    radius: opts.radius || 5,
    damage: opts.damage || 10,
    color: opts.color || '#e74c3c',
    range: opts.range || 400,
    dist: 0,
    source: opts.source || 'enemy',
  });
}

// Called from enemy AI tick — decides when each shooter fires.
export function enemyShootingAi(g, e, dt, targetPlayer) {
  if (!e.shootCooldown || e.stunTimer > 0) return;
  e.shootTimer = (e.shootTimer || 0) - dt;
  if (e.shootTimer > 0) return;
  if (!targetPlayer || targetPlayer.dist > e.shootRange) return;

  const px = targetPlayer.p.x, py = targetPlayer.p.y;

  if (e.name === 'elite') {
    // Elite: single aimed shot
    e.shootTimer = e.shootCooldown + g.rng.random() * 0.5;
    fireEnemyProjectile(g, e.x, e.y, px, py, {
      speed: e.shootSpeed || 180,
      damage: e.shootDamage || 12,
      radius: 5,
      color: '#6c5ce7',
      range: e.shootRange,
      source: e.name,
    });
    emit(g, EVT.ENEMY_SHOOT, { x: e.x, y: e.y, name: e.name });
  } else if (e.name === 'boss') {
    // Boss: 3-shot spread burst
    e.shootTimer = e.shootCooldown + g.rng.random() * 1.0;
    const dx = px - e.x, dy = py - e.y;
    const baseAngle = Math.atan2(dy, dx);
    const spread = 0.25; // ~14 degrees per side
    for (let s = -1; s <= 1; s++) {
      const a = baseAngle + s * spread;
      const tx = e.x + Math.cos(a) * 500;
      const ty = e.y + Math.sin(a) * 500;
      fireEnemyProjectile(g, e.x, e.y, tx, ty, {
        speed: e.shootSpeed || 160,
        damage: e.shootDamage || 20,
        radius: 7,
        color: '#d63031',
        range: e.shootRange,
        source: e.name,
      });
    }
    emit(g, EVT.ENEMY_SHOOT, { x: e.x, y: e.y, name: e.name });
  }
}

// Move enemy projectiles, check wall collisions, check player collisions.
export function updateEnemyProjectiles(g, dt) {
  const obstacles = g.obstacles;
  for (let i = g.enemyProjectiles.length - 1; i >= 0; i--) {
    const p = g.enemyProjectiles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.dist += p.speed * dt;

    // Range limit
    if (p.dist > p.range) {
      g.enemyProjectiles.splice(i, 1);
      continue;
    }

    // Wall/obstacle collision
    let blocked = false;
    if (obstacles && obstacles.length > 0) {
      for (const obs of obstacles) {
        if (!PROJECTILE_BLOCKERS.has(obs.type)) continue;
        if (circleRectCollision(p.x, p.y, p.radius, obs.x, obs.y, obs.w, obs.h)) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) {
      g.enemyProjectiles.splice(i, 1);
      continue;
    }

    // Player collision — hits the first alive player it overlaps
    for (const pl of g.players) {
      if (!pl.alive || pl.iframes > 0) continue;
      const dx = pl.x - p.x, dy = pl.y - p.y;
      if (dx * dx + dy * dy < (pl.radius + p.radius) ** 2) {
        const dmg = Math.max(1, p.damage - (pl.armor || 0));
        pl.hp -= dmg;
        pl.iframes = 0.5;
        emit(g, EVT.PLAYER_HIT, { x: pl.x, y: pl.y, dmg, by: p.source, pid: pl.id });
        if (pl.hp <= 0) {
          pl.hp = 0;
          pl.alive = false;
          emit(g, EVT.PLAYER_DEATH, { x: pl.x, y: pl.y, by: p.source, pid: pl.id });
        }
        g.enemyProjectiles.splice(i, 1);
        break;
      }
    }
  }
}
