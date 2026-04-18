// Enemy projectile system — ranged attacks from elites + bosses.
// Separate from player projectiles so collision only checks players,
// not enemies. Obstacles block enemy shots the same way they block
// player shots.
import { EVT, emit } from './events.js';
import { circleRectCollision } from './collision.js';
import { PROJECTILE_BLOCKERS } from '../maps.js';
import { checkPhoenixRevive } from './damage.js';

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
    homing: opts.homing || false,
    turnRate: opts.turnRate || 0,
  });
}

// Called from enemy AI tick — decides when each shooter fires.
//
// Two-phase: enemy spends `aimDuration` seconds locked onto the
// target before firing, emitting ENEMY_AIM at windup start so the
// client can render a telegraph. Gives players a reaction window
// — vs the old "instant fire as soon as cooldown expires" which
// was undodgeable.
const AIM_DURATION = { elite: 0.4, boss: 0.55 };

export function enemyShootingAi(g, e, dt, targetPlayer) {
  if (!e.shootCooldown || e.stunTimer > 0) return;

  // Mid-windup: tick down the aim timer, fire when it hits zero.
  if (e.aimTimer > 0) {
    e.aimTimer -= dt;
    if (e.aimTimer <= 0) {
      releaseShot(g, e, e.aimTargetX, e.aimTargetY);
      e.shootTimer = e.shootCooldown + g.rng.random() * (e.name === 'boss' ? 1.0 : 0.5);
    }
    return;
  }

  e.shootTimer = (e.shootTimer || 0) - dt;
  if (e.shootTimer > 0) return;
  if (!targetPlayer || targetPlayer.dist > e.shootRange) return;
  if (!AIM_DURATION[e.name]) return;

  // Lock target + start windup. Aim coords stay frozen even if
  // the player moves during windup — that's the dodge window.
  e.aimTimer = AIM_DURATION[e.name];
  e.aimTargetX = targetPlayer.p.x;
  e.aimTargetY = targetPlayer.p.y;
  emit(g, EVT.ENEMY_AIM, {
    x: e.x, y: e.y,
    tx: e.aimTargetX, ty: e.aimTargetY,
    name: e.name,
    duration: e.aimTimer,
  });
}

function releaseShot(g, e, tx, ty) {
  if (e.name === 'elite') {
    fireEnemyProjectile(g, e.x, e.y, tx, ty, {
      speed: e.shootSpeed || 180,
      damage: e.shootDamage || 12,
      radius: 5,
      color: '#6c5ce7',
      range: e.shootRange,
      source: e.name,
    });
  } else if (e.name === 'boss') {
    const dx = tx - e.x, dy = ty - e.y;
    const baseAngle = Math.atan2(dy, dx);
    const phase = e.phase || 1;

    if (phase === 5) {
      // 5 tight homing projectiles — dense spread at ±0.15 rad,
      // higher turn rate than phases 3-4. Fast enough that threading
      // the gaps requires deliberate movement, not just lateral drift.
      for (let s = -2; s <= 2; s++) {
        const a = baseAngle + s * 0.15;
        const sx = e.x + Math.cos(a) * 500;
        const sy = e.y + Math.sin(a) * 500;
        fireEnemyProjectile(g, e.x, e.y, sx, sy, {
          speed: (e.shootSpeed || 160) * 1.25,
          damage: e.shootDamage || 20,
          radius: 7,
          color: '#6c0000',
          range: e.shootRange,
          source: e.name,
          homing: true,
          turnRate: 2.2,
        });
      }
    } else if (phase >= 3) {
      // 3 homing projectiles — curve toward nearest player at up to
      // 1.5 rad/s so they're threatening but still jukeable. Phase 4
      // (enrage) keeps the homing pattern but fires at the lower
      // shootCooldown set in updateBossAi.
      for (let s = -1; s <= 1; s++) {
        const a = baseAngle + s * 0.25;
        const sx = e.x + Math.cos(a) * 500;
        const sy = e.y + Math.sin(a) * 500;
        fireEnemyProjectile(g, e.x, e.y, sx, sy, {
          speed: e.shootSpeed || 160,
          damage: e.shootDamage || 20,
          radius: 7,
          color: '#d63031',
          range: e.shootRange,
          source: e.name,
          homing: true,
          turnRate: 1.5,
        });
      }
    } else if (phase === 2) {
      // 5-shot spread at ±0.20 rad — tighter cone, more coverage.
      for (let s = -2; s <= 2; s++) {
        const a = baseAngle + s * 0.20;
        const sx = e.x + Math.cos(a) * 500;
        const sy = e.y + Math.sin(a) * 500;
        fireEnemyProjectile(g, e.x, e.y, sx, sy, {
          speed: e.shootSpeed || 160,
          damage: e.shootDamage || 20,
          radius: 7,
          color: '#d63031',
          range: e.shootRange,
          source: e.name,
        });
      }
    } else {
      // Phase 1 — 3-shot spread at ±0.25 rad (original behavior).
      for (let s = -1; s <= 1; s++) {
        const a = baseAngle + s * 0.25;
        const sx = e.x + Math.cos(a) * 500;
        const sy = e.y + Math.sin(a) * 500;
        fireEnemyProjectile(g, e.x, e.y, sx, sy, {
          speed: e.shootSpeed || 160,
          damage: e.shootDamage || 20,
          radius: 7,
          color: '#d63031',
          range: e.shootRange,
          source: e.name,
        });
      }
    }
  }
  emit(g, EVT.ENEMY_SHOOT, { x: e.x, y: e.y, name: e.name });
}

// Move enemy projectiles, check wall collisions, check player collisions.
export function updateEnemyProjectiles(g, dt) {
  const obstacles = g.obstacles;
  for (let i = g.enemyProjectiles.length - 1; i >= 0; i--) {
    const p = g.enemyProjectiles[i];

    // Homing — steer toward nearest alive player each tick, capped at
    // turnRate rad/s so players can juke with good movement. Angular
    // clamp keeps fast projectiles from snap-tracking on contact range.
    if (p.homing && p.turnRate > 0) {
      let nearest = null, nearestD2 = Infinity;
      for (const pl of g.players) {
        if (!pl.alive) continue;
        const dx = pl.x - p.x, dy = pl.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) { nearest = pl; nearestD2 = d2; }
      }
      if (nearest) {
        const targetAngle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
        const currentAngle = Math.atan2(p.vy, p.vx);
        let da = targetAngle - currentAngle;
        // Normalize to [-π, π]
        if (da > Math.PI) da -= Math.PI * 2;
        else if (da < -Math.PI) da += Math.PI * 2;
        const maxTurn = p.turnRate * dt;
        da = Math.max(-maxTurn, Math.min(maxTurn, da));
        const newAngle = currentAngle + da;
        p.vx = Math.cos(newAngle) * p.speed;
        p.vy = Math.sin(newAngle) * p.speed;
      }
    }

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
        if (pl.hp <= 0 && !checkPhoenixRevive(g, pl)) {
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
