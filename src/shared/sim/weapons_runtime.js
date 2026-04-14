// Per-tick weapon logic: fireWeapon dispatch + every weapon's
// always-on update branches (orbit blade rotation, shield aura,
// lightning field on-fire zap, charge active timer, breath aura,
// charge sweep, chain effect lifetime, meteor warn/explode lifecycle,
// dragon storm aura). Pure sim — emits WEAPON_FIRE, CHAIN_ZAP,
// METEOR_WARN, METEOR_EXPLODE, SHIELD_HUM, CHARGE_BURST events.
import { WORLD_W, WORLD_H } from '../constants.js';
import { EVT, emit } from './events.js';
import { damageEnemy } from './damage.js';

// --- one-shot fire dispatch (called when w.timer hits 0) ---
export function fireWeapon(g, w) {
  const p = g.player;
  if (w.type === 'spit')         fireSpit(g, w, p);
  else if (w.type === 'charge')  fireCharge(g, w, p);
  else if (w.type === 'chain')   fireChain(g, w, p);
  else if (w.type === 'meteor')  fireMeteor(g, w, p);
  else if (w.type === 'dragon_storm') fireDragonStorm(g, w, p);
  // breath, orbit, shield, lightning_field don't "fire" — always-on.
}

function fireSpit(g, w, p) {
  let nearest = null, nearestDist = w.range;
  for (const e of g.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < nearestDist) { nearest = e; nearestDist = d; }
  }
  if (!nearest) return;
  emit(g, EVT.WEAPON_FIRE, { weapon: 'spit', x: p.x, y: p.y });
  const dx = nearest.x - p.x, dy = nearest.y - p.y;
  const d = Math.hypot(dx, dy);
  const nx = dx / d, ny = dy / d;
  for (let i = 0; i < w.count; i++) {
    const spread = w.count > 1 ? (i - (w.count - 1) / 2) * 0.15 : 0;
    const cos = Math.cos(spread), sin = Math.sin(spread);
    const fx = nx * cos - ny * sin;
    const fy = nx * sin + ny * cos;
    g.projectiles.push({
      x: p.x + fx * 20, y: p.y + fy * 20,
      vx: fx * w.speed, vy: fy * w.speed,
      speed: w.speed, damage: w.damage, range: w.range,
      dist: 0, pierce: w.pierce, radius: 5, color: w.color,
    });
  }
}

function fireCharge(g, w, p) {
  const f = p.facing;
  const d = Math.hypot(f.x, f.y);
  if (d <= 0.01) return;
  w.active = true;
  w.chargeTimer = w.duration;
  w.chargeDx = f.x / d;
  w.chargeDy = f.y / d;
  p.x += w.chargeDx * w.speed * w.duration;
  p.y += w.chargeDy * w.speed * w.duration;
  p.x = Math.max(p.radius, Math.min(WORLD_W - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(WORLD_H - p.radius, p.y));
  emit(g, EVT.CHARGE_BURST, { x: p.x, y: p.y, color: w.color });
}

function fireChain(g, w, p) {
  if (g.enemies.length === 0) return;
  emit(g, EVT.WEAPON_FIRE, { weapon: 'chain' });
  // sort by distance to player; pick first; then walk chain
  const sorted = g.enemies.slice().sort((a, b) => {
    const da = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
    const db = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
    return da - db;
  });
  const inRange = sorted.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < w.range);
  if (inRange.length === 0) return;
  const targets = [inRange[0]];
  const hit = new Set([inRange[0]]);
  for (let c = 0; c < w.chains && targets.length > 0; c++) {
    const last = targets[targets.length - 1];
    let best = null, bestDist = w.chainRange;
    for (const e of g.enemies) {
      if (hit.has(e)) continue;
      const d = Math.hypot(e.x - last.x, e.y - last.y);
      if (d < bestDist) { best = e; bestDist = d; }
    }
    if (best) { targets.push(best); hit.add(best); }
  }
  const chainPoints = [{ x: p.x, y: p.y }];
  for (const t of targets) {
    chainPoints.push({ x: t.x, y: t.y });
    for (let j = g.enemies.length - 1; j >= 0; j--) {
      if (g.enemies[j] === t) {
        damageEnemy(g, g.enemies[j], j, w.damage * p.damageMulti);
        break;
      }
    }
  }
  g.chainEffects.push({ points: chainPoints, life: 0.2, color: w.color });
}

function fireMeteor(g, w, p) {
  if (g.enemies.length === 0) return;
  const target = g.enemies[g.rng.int(g.enemies.length)];
  g.meteorEffects.push({
    x: target.x, y: target.y,
    radius: w.blastRadius,
    damage: w.damage * p.damageMulti,
    life: 0.5,
    phase: 'warn',
    color: w.color,
  });
  emit(g, EVT.METEOR_WARN, { x: target.x, y: target.y, radius: w.blastRadius });
}

function fireDragonStorm(g, w, p) {
  if (g.enemies.length === 0) return;
  w._fireCount = (w._fireCount || 0) + 1;
  if (w._fireCount % 3 === 1) emit(g, EVT.WEAPON_FIRE, { weapon: 'dragon_storm' });
  let nearest = null, nearestDist = w.range;
  for (const e of g.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < nearestDist) { nearest = e; nearestDist = d; }
  }
  if (!nearest) return;
  const dx = nearest.x - p.x, dy = nearest.y - p.y;
  const d = Math.hypot(dx, dy);
  for (let i = 0; i < w.count; i++) {
    const spread = (i - (w.count - 1) / 2) * 0.2;
    const cos = Math.cos(spread), sin = Math.sin(spread);
    const fx = (dx / d) * cos - (dy / d) * sin;
    const fy = (dx / d) * sin + (dy / d) * cos;
    g.projectiles.push({
      x: p.x + fx * 20, y: p.y + fy * 20,
      vx: fx * w.speed, vy: fy * w.speed,
      speed: w.speed, damage: w.damage, range: w.range,
      dist: 0, pierce: w.pierce, radius: 7, color: w.color,
    });
  }
}

// --- per-tick always-on weapon branches ---
// Iterates all player weapons and ticks per-type state: phase animations,
// charge active timer, orbit blade rotation+damage, shield aura, lightning
// field on-fire zap. Cooldown + fireWeapon dispatch lives here too.
export function updateWeapons(g, dt) {
  const p = g.player;
  for (const w of p.weapons) {
    w.timer -= dt * p.attackSpeedMulti;
    if (w.timer <= 0) {
      w.timer = w.cooldown;
      fireWeapon(g, w);
    }
    if (w.type === 'breath') w.pulsePhase = (w.pulsePhase || 0) + dt * 3;
    if (w.type === 'dragon_storm') w.pulsePhase = (w.pulsePhase || 0) + dt * 4;

    if (w.type === 'charge' && w.active) {
      w.chargeTimer -= dt;
      if (w.chargeTimer <= 0) w.active = false;
    }

    if (w.type === 'orbit') tickOrbit(g, w, p, dt);
    if (w.type === 'shield') tickShield(g, w, p, dt);
    if (w.type === 'lightning_field' && w.timer >= w.cooldown - 0.01) tickLightningField(g, w, p);
  }
}

function tickOrbit(g, w, p, dt) {
  w.phase = (w.phase || 0) + w.rotSpeed * dt;
  for (let b = 0; b < w.bladeCount; b++) {
    const angle = w.phase + (b * Math.PI * 2 / w.bladeCount);
    const bx = p.x + Math.cos(angle) * w.radius;
    const by = p.y + Math.sin(angle) * w.radius;
    for (let j = g.enemies.length - 1; j >= 0; j--) {
      const e = g.enemies[j];
      const dx = bx - e.x, dy = by - e.y;
      if (dx * dx + dy * dy < (10 + e.radius) ** 2) {
        damageEnemy(g, e, j, w.damage * p.damageMulti * dt * 8);
      }
    }
  }
}

function tickShield(g, w, p, dt) {
  w.phase = (w.phase || 0) + dt * 4;
  let hit = false;
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const edx = e.x - p.x, edy = e.y - p.y;
    const dist = Math.hypot(edx, edy);
    if (dist < w.radius + e.radius && dist > 1) {
      hit = true;
      const nx = edx / dist, ny = edy / dist;
      e.x += nx * w.knockback * dt;
      e.y += ny * w.knockback * dt;
      damageEnemy(g, e, j, w.damage * p.damageMulti * dt * 2);
    }
  }
  if (hit) {
    w._humTimer = (w._humTimer || 0) - dt;
    if (w._humTimer <= 0) {
      emit(g, EVT.SHIELD_HUM);
      w._humTimer = 0.4;
    }
  }
}

function tickLightningField(g, w, p) {
  // just fired (timer was reset) — pick zapCount targets in radius
  const inRange = [];
  for (const e of g.enemies) {
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d2 < w.radius * w.radius) inRange.push(e);
  }
  // shuffle in place (Fisher-Yates)
  for (let z = inRange.length - 1; z > 0; z--) {
    const r = g.rng.int(z + 1);
    [inRange[z], inRange[r]] = [inRange[r], inRange[z]];
  }
  const targets = inRange.slice(0, w.zapCount);
  for (const t of targets) {
    for (let j = g.enemies.length - 1; j >= 0; j--) {
      if (g.enemies[j] === t) {
        damageEnemy(g, g.enemies[j], j, w.damage * p.damageMulti);
        break;
      }
    }
    g.chainEffects.push({ points: [{ x: p.x, y: p.y }, { x: t.x, y: t.y }], life: 0.15, color: w.color });
  }
  if (targets.length > 0) emit(g, EVT.CHAIN_ZAP, { weapon: 'lightning_field' });
}

// --- post-projectile damage passes (breath aura + charge sweep) ---
// Both run after projectiles so the player's projectiles see enemies at
// their pre-damage positions, matching original ordering.
export function updateAuras(g, dt) {
  const p = g.player;
  for (const w of p.weapons) {
    if (w.type === 'breath') tickBreathAura(g, w, p, dt);
    else if (w.type === 'charge' && w.active) tickChargeSweep(g, w, p, dt);
    else if (w.type === 'dragon_storm') tickDragonStormAura(g, w, p, dt);
  }
}

function tickBreathAura(g, w, p, dt) {
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const edx = p.x - e.x, edy = p.y - e.y;
    const dist = Math.hypot(edx, edy);
    if (dist < w.radius + e.radius) {
      damageEnemy(g, e, j, w.damage * p.damageMulti * dt);
    }
  }
}

function tickChargeSweep(g, w, p, dt) {
  const cdx = w.chargeDx, cdy = w.chargeDy;
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const ex = e.x - p.x, ey = e.y - p.y;
    const forward = ex * cdx + ey * cdy;
    const lateral = Math.abs(ex * (-cdy) + ey * cdx);
    if (forward > -w.width && forward < w.speed * w.duration && lateral < w.width + e.radius) {
      damageEnemy(g, e, j, w.damage * p.damageMulti * dt * 3);
    }
  }
}

function tickDragonStormAura(g, w, p, dt) {
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const dx = p.x - e.x, dy = p.y - e.y;
    if (dx * dx + dy * dy < (w.auraRadius + e.radius) ** 2) {
      damageEnemy(g, e, j, w.auraDamage * p.damageMulti * dt);
    }
  }
}

// --- chain + meteor effect lifetimes ---
export function updateChainEffects(g, dt) {
  for (let i = g.chainEffects.length - 1; i >= 0; i--) {
    g.chainEffects[i].life -= dt;
    if (g.chainEffects[i].life <= 0) g.chainEffects.splice(i, 1);
  }
}

export function updateMeteorEffects(g, dt) {
  for (let i = g.meteorEffects.length - 1; i >= 0; i--) {
    const m = g.meteorEffects[i];
    m.life -= dt;
    if (m.phase === 'warn' && m.life <= 0) {
      m.phase = 'explode';
      m.life = 0.3;
      emit(g, EVT.METEOR_EXPLODE, { x: m.x, y: m.y, color: m.color, radius: m.radius });
      for (let j = g.enemies.length - 1; j >= 0; j--) {
        const e = g.enemies[j];
        const dx = m.x - e.x, dy = m.y - e.y;
        if (dx * dx + dy * dy < (m.radius + e.radius) ** 2) {
          damageEnemy(g, g.enemies[j], j, m.damage);
        }
      }
    } else if (m.phase === 'explode' && m.life <= 0) {
      g.meteorEffects.splice(i, 1);
    }
  }
}
