// Per-tick weapon logic. Operates on g.players (every alive player gets
// a tick); single-player wraps `[g.player]` so the same code drives SP
// and MP. Pure sim — emits WEAPON_FIRE, CHAIN_ZAP, METEOR_WARN,
// METEOR_EXPLODE, SHIELD_HUM, CHARGE_BURST events.
import { EVT, emit } from './events.js';
import { damageEnemy } from './damage.js';

// --- one-shot fire dispatch (called when w.timer hits 0) ---
// breath, orbit, shield, lightning_field don't "fire" — always-on.
function fireWeapon(g, w, p) {
  if (w.type === 'spit')         fireSpit(g, w, p);
  else if (w.type === 'charge')  fireCharge(g, w, p);
  else if (w.type === 'chain')   fireChain(g, w, p);
  else if (w.type === 'meteor')  fireMeteor(g, w, p);
  else if (w.type === 'dragon_storm') fireDragonStorm(g, w, p);
  else if (w.type === 'thunder_god')  fireThunderGod(g, w, p);
  else if (w.type === 'meteor_orbit') fireMeteorOrbit(g, w, p);
  else if (w.type === 'fortress')     fireCharge(g, w, p);
}

function fireSpit(g, w, p) {
  let nearest = null, nearestDist = w.range;
  for (const e of g.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < nearestDist) { nearest = e; nearestDist = d; }
  }
  if (!nearest) return;
  emit(g, EVT.WEAPON_FIRE, { weapon: 'spit', x: p.x, y: p.y, pid: p.id });
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
      owner: p.id,
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
  p.x = Math.max(p.radius, Math.min(g.arena.w - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(g.arena.h - p.radius, p.y));
  emit(g, EVT.CHARGE_BURST, { x: p.x, y: p.y, color: w.color, pid: p.id });
}

function fireChain(g, w, p) {
  if (g.enemies.length === 0) return;
  const sorted = g.enemies.slice().sort((a, b) => {
    const da = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
    const db = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
    return da - db;
  });
  const inRange = sorted.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < w.range);
  if (inRange.length === 0) return;
  emit(g, EVT.WEAPON_FIRE, { weapon: 'chain', pid: p.id });
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
        damageEnemy(g, g.enemies[j], w.damage * p.damageMulti, p.id);
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
    owner: p.id,
  });
  emit(g, EVT.METEOR_WARN, { x: target.x, y: target.y, radius: w.blastRadius });
}

function fireDragonStorm(g, w, p) {
  if (g.enemies.length === 0) return;
  w._fireCount = (w._fireCount || 0) + 1;
  if (w._fireCount % 3 === 1) emit(g, EVT.WEAPON_FIRE, { weapon: 'dragon_storm', pid: p.id });
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
      owner: p.id,
    });
  }
}

// Iterates every alive player and their weapons. Cooldowns + fire
// dispatch + always-on per-type ticks (orbit/shield/lightning_field).
export function updateWeapons(g, dt) {
  for (const p of g.players) {
    if (!p.alive) continue;
    for (const w of p.weapons) {
      w.timer -= dt * p.attackSpeedMulti;
      if (w.timer <= 0) {
        w.timer = w.cooldown;
        fireWeapon(g, w, p);
      }
      if (w.type === 'breath') w.pulsePhase = (w.pulsePhase || 0) + dt * 3;
      if (w.type === 'dragon_storm') w.pulsePhase = (w.pulsePhase || 0) + dt * 4;

      if ((w.type === 'charge' || w.type === 'fortress') && w.active) {
        w.chargeTimer -= dt;
        if (w.chargeTimer <= 0) {
          w.active = false;
          if (w.type === 'fortress') fortressShockwave(g, w, p);
        }
      }

      if (w.type === 'orbit') tickOrbit(g, w, p, dt);
      if (w.type === 'shield') tickShield(g, w, p, dt);
      if (w.type === 'lightning_field' && w.timer >= w.cooldown - 0.01) tickLightningField(g, w, p);
      if (w.type === 'meteor_orbit') tickMeteorOrbit(g, w, p, dt);
      if (w.type === 'fortress') tickFortressShield(g, w, p, dt);
      if (w.type === 'thunder_god' && w.timer >= w.cooldown - 0.01) tickThunderField(g, w, p);
    }
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
        damageEnemy(g, e, w.damage * p.damageMulti * dt * 8, p.id);
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
      damageEnemy(g, e, w.damage * p.damageMulti * dt * 2, p.id);
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
  const inRange = [];
  for (const e of g.enemies) {
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d2 < w.radius * w.radius) inRange.push(e);
  }
  for (let z = inRange.length - 1; z > 0; z--) {
    const r = g.rng.int(z + 1);
    [inRange[z], inRange[r]] = [inRange[r], inRange[z]];
  }
  const targets = inRange.slice(0, w.zapCount);
  for (const t of targets) {
    for (let j = g.enemies.length - 1; j >= 0; j--) {
      if (g.enemies[j] === t) {
        damageEnemy(g, g.enemies[j], w.damage * p.damageMulti, p.id);
        break;
      }
    }
    g.chainEffects.push({ points: [{ x: p.x, y: p.y }, { x: t.x, y: t.y }], life: 0.15, color: w.color });
  }
  if (targets.length > 0) emit(g, EVT.CHAIN_ZAP, { weapon: 'lightning_field', pid: p.id });
}

// Post-projectile damage passes (breath aura + charge/fortress sweep +
// dragon storm aura). Same iteration shape as updateWeapons — once per
// alive player. Fortress reuses the charge sweep because its fields
// (speed/duration/width/damage/active/chargeDx/Dy) match.
export function updateAuras(g, dt) {
  for (const p of g.players) {
    if (!p.alive) continue;
    for (const w of p.weapons) {
      if (w.type === 'breath') tickBreathAura(g, w, p, dt);
      else if ((w.type === 'charge' || w.type === 'fortress') && w.active) tickChargeSweep(g, w, p, dt);
      else if (w.type === 'dragon_storm') tickDragonStormAura(g, w, p, dt);
    }
  }
}

function tickBreathAura(g, w, p, dt) {
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const edx = p.x - e.x, edy = p.y - e.y;
    const dist = Math.hypot(edx, edy);
    if (dist < w.radius + e.radius) {
      damageEnemy(g, e, w.damage * p.damageMulti * dt, p.id);
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
      damageEnemy(g, e, w.damage * p.damageMulti * dt * 3, p.id);
    }
  }
}

function tickDragonStormAura(g, w, p, dt) {
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const dx = p.x - e.x, dy = p.y - e.y;
    if (dx * dx + dy * dy < (w.auraRadius + e.radius) ** 2) {
      damageEnemy(g, e, w.auraDamage * p.damageMulti * dt, p.id);
    }
  }
}

// --- Thunder God ---
// Chain fires each cooldown; field is scheduled alongside via the
// `w.timer >= w.cooldown - 0.01` guard in updateWeapons so both count as
// one "fire" for overcharge gating.
function fireThunderGod(g, w, p) {
  w.fireCount = (w.fireCount || 0) + 1;
  fireChain(g, w, p);
}

function tickThunderField(g, w, p) {
  const inRange = [];
  for (const e of g.enemies) {
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d2 < w.fieldRadius * w.fieldRadius) inRange.push(e);
  }
  if (inRange.length === 0) return;
  // Every `overchargeEvery`th fire hits everyone in range at 2x and
  // stuns — a rhythmic crowd-wipe that makes the weapon feel climactic.
  const overcharge = w.fireCount > 0 && w.fireCount % w.overchargeEvery === 0;
  if (overcharge) {
    for (const e of inRange) {
      damageEnemy(g, e, w.fieldDamage * 2 * p.damageMulti, p.id);
      e.stunTimer = Math.max(e.stunTimer || 0, 0.3);
    }
    emit(g, EVT.CHAIN_ZAP, { weapon: 'thunder_god_overcharge', pid: p.id });
    return;
  }
  for (let z = inRange.length - 1; z > 0; z--) {
    const r = g.rng.int(z + 1);
    [inRange[z], inRange[r]] = [inRange[r], inRange[z]];
  }
  const targets = inRange.slice(0, w.zapCount);
  for (const t of targets) {
    damageEnemy(g, t, w.fieldDamage * p.damageMulti, p.id);
    g.chainEffects.push({ points: [{ x: p.x, y: p.y }, { x: t.x, y: t.y }], life: 0.15, color: w.color });
  }
  emit(g, EVT.CHAIN_ZAP, { weapon: 'thunder_god', pid: p.id });
}

// --- Meteor Orbit ---
function fireMeteorOrbit(g, w, p) {
  if (g.enemies.length === 0) return;
  const target = g.enemies[g.rng.int(g.enemies.length)];
  g.meteorEffects.push({
    x: target.x, y: target.y,
    radius: w.blastRadius,
    damage: w.damage * p.damageMulti,
    life: 0.5, phase: 'warn',
    color: w.color, owner: p.id,
  });
  emit(g, EVT.METEOR_WARN, { x: target.x, y: target.y, radius: w.blastRadius });
}

function tickMeteorOrbit(g, w, p, dt) {
  w.phase = (w.phase || 0) + w.rotSpeed * dt;
  for (let b = 0; b < w.bladeCount; b++) {
    const angle = w.phase + (b * Math.PI * 2 / w.bladeCount);
    const bx = p.x + Math.cos(angle) * w.radius;
    const by = p.y + Math.sin(angle) * w.radius;
    for (let j = g.enemies.length - 1; j >= 0; j--) {
      const e = g.enemies[j];
      const dx = bx - e.x, dy = by - e.y;
      if (dx * dx + dy * dy < (10 + e.radius) ** 2) {
        const killed = damageEnemy(g, e, w.bladeDamage * p.damageMulti * dt * 8, p.id);
        // Chain-reaction trigger: mini-meteor at the kill site. Queued as
        // a normal meteor with `warn` phase 0 → explode in 0.15s.
        if (killed) {
          g.meteorEffects.push({
            x: e.x, y: e.y,
            radius: w.miniMeteorRadius,
            damage: w.miniMeteorDamage * p.damageMulti,
            life: 0.15, phase: 'warn',
            color: w.color, owner: p.id,
          });
          emit(g, EVT.METEOR_WARN, { x: e.x, y: e.y, radius: w.miniMeteorRadius });
        }
      }
    }
  }
}

// --- Fortress ---
// Reuses fireCharge — fortress stat field names (duration/speed/width/
// damage) match charge on purpose so the existing code works unchanged.

function tickFortressShield(g, w, p, dt) {
  w.phase = (w.phase || 0) + dt * 4;
  let hit = false;
  for (const e of g.enemies) {
    const edx = e.x - p.x, edy = e.y - p.y;
    const dist = Math.hypot(edx, edy);
    if (dist < w.shieldRadius + e.radius && dist > 1) {
      hit = true;
      const nx = edx / dist, ny = edy / dist;
      e.x += nx * w.knockback * dt;
      e.y += ny * w.knockback * dt;
      damageEnemy(g, e, w.shieldDamage * p.damageMulti * dt * 2, p.id);
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

function fortressShockwave(g, w, p) {
  for (const e of g.enemies) {
    const dx = e.x - p.x, dy = e.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < w.shockwaveRadius + e.radius) {
      damageEnemy(g, e, w.shockwaveDamage * p.damageMulti, p.id);
      if (dist > 1) {
        const push = 200;
        e.x += (dx / dist) * push * 0.05;
        e.y += (dy / dist) * push * 0.05;
      }
    }
  }
  // Reuse meteor explode effect for the visual — expanding ring at the
  // endpoint reads well and saves a new render path.
  g.meteorEffects.push({
    x: p.x, y: p.y,
    radius: w.shockwaveRadius,
    damage: 0, life: 0.25, phase: 'explode',
    color: w.color, owner: p.id,
  });
  emit(g, EVT.METEOR_EXPLODE, { x: p.x, y: p.y, color: w.color, radius: w.shockwaveRadius });
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
          damageEnemy(g, g.enemies[j], m.damage, m.owner);
        }
      }
    } else if (m.phase === 'explode' && m.life <= 0) {
      g.meteorEffects.splice(i, 1);
    }
  }
}
