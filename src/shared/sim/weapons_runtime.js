// Per-tick weapon logic. Operates on g.players (every alive player gets
// a tick); single-player wraps `[g.player]` so the same code drives SP
// and MP. Pure sim — emits WEAPON_FIRE, CHAIN_ZAP, METEOR_WARN,
// METEOR_EXPLODE, SHIELD_HUM, CHARGE_BURST events.
import { EVT, emit } from './events.js';
import { damageEnemy } from './damage.js';
import { applyStatus } from './enemies.js';

// Random-N enemies inside a circular range, drawn via Fisher-Yates so
// the choice tracks g.rng deterministically. Used by lightning_field +
// thunder_god's field tick.
function randomEnemiesInRange(g, x, y, radius, count) {
  const inRange = [];
  for (const e of g.enemies) {
    const dx = e.x - x, dy = e.y - y;
    if (dx * dx + dy * dy < radius * radius) inRange.push(e);
  }
  for (let i = inRange.length - 1; i > 0; i--) {
    const j = g.rng.int(i + 1);
    [inRange[i], inRange[j]] = [inRange[j], inRange[i]];
  }
  return inRange.slice(0, count);
}

// --- one-shot fire dispatch (called when w.timer hits 0) ---
// breath/orbit/shield/lightning_field/thunder_god/meteor_orbit/fortress
// have always-on ticks too — see updateWeapons below.
function fireWeapon(g, w, p) {
  if (w.type === 'spit')         fireSpit(g, w, p);
  else if (w.type === 'charge')  fireCharge(g, w, p);
  else if (w.type === 'chain')   fireChain(g, w, p);
  else if (w.type === 'meteor')  fireMeteor(g, w, p);
  else if (w.type === 'dragon_storm') fireDragonStorm(g, w, p);
  else if (w.type === 'thunder_god')  fireThunderGod(g, w, p);
  else if (w.type === 'meteor_orbit') fireMeteor(g, w, p);
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
  const count = w.count + (p.projectileBonus || 0);
  for (let i = 0; i < count; i++) {
    const spread = count > 1 ? (i - (count - 1) / 2) * 0.15 : 0;
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
  const startX = p.x, startY = p.y;
  p.x += w.chargeDx * w.speed * w.duration;
  p.y += w.chargeDy * w.speed * w.duration;
  p.x = Math.max(p.radius, Math.min(g.arena.w - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(g.arena.h - p.radius, p.y));
  emit(g, EVT.CHARGE_BURST, { x: p.x, y: p.y, color: w.color, pid: p.id });
  // Fire wake — drop damage zones along the dash path. Enemies
  // that walk through the trail take half charge damage per tick.
  // Rewards aggressive pathing through enemy packs.
  if (!g.chargeTrails) g.chargeTrails = [];
  const trailDist = Math.hypot(p.x - startX, p.y - startY);
  const zones = Math.max(3, Math.floor(trailDist / 30));
  const effectiveWidth = w.width * (p.sizeMulti || 1);
  for (let i = 0; i <= zones; i++) {
    const t = i / zones;
    g.chargeTrails.push({
      x: startX + (p.x - startX) * t,
      y: startY + (p.y - startY) * t,
      radius: effectiveWidth * 0.6,
      damage: w.damage * 0.5 * (p.damageMulti || 1),
      life: 1.0,     // 1 second lingering trail
      owner: p.id,
      color: w.color,
    });
  }
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
  const chains = w.chains + (p.projectileBonus || 0);
  for (let c = 0; c < chains && targets.length > 0; c++) {
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
    damageEnemy(g, t, w.damage * p.damageMulti, p.id);
    applyStatus(g, t, { type: 'slow', remaining: 2.0, magnitude: 0.4, tickRate: 0 });
  }
  g.chainEffects.push({ points: chainPoints, life: 0.2, color: w.color });
}

function fireMeteor(g, w, p) {
  if (g.enemies.length === 0) return;
  const target = g.enemies[g.rng.int(g.enemies.length)];
  g.meteorEffects.push({
    x: target.x, y: target.y,
    radius: w.blastRadius * (p.sizeMulti || 1),
    damage: w.damage * p.damageMulti,
    life: 0.5,
    phase: 'warn',
    color: w.color,
    owner: p.id,
  });
  emit(g, EVT.METEOR_WARN, { x: target.x, y: target.y, radius: w.blastRadius * (p.sizeMulti || 1) });
}

function fireDragonStorm(g, w, p) {
  if (g.enemies.length === 0) return;
  w.fireCount = (w.fireCount || 0) + 1;
  if (w.fireCount % 3 === 1) emit(g, EVT.WEAPON_FIRE, { weapon: 'dragon_storm', pid: p.id });
  let nearest = null, nearestDist = w.range;
  for (const e of g.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < nearestDist) { nearest = e; nearestDist = d; }
  }
  if (!nearest) return;
  const dx = nearest.x - p.x, dy = nearest.y - p.y;
  const d = Math.hypot(dx, dy);
  const dsCount = w.count + (p.projectileBonus || 0);
  for (let i = 0; i < dsCount; i++) {
    const spread = (i - (dsCount - 1) / 2) * 0.2;
    const cos = Math.cos(spread), sin = Math.sin(spread);
    const fx = (dx / d) * cos - (dy / d) * sin;
    const fy = (dx / d) * sin + (dy / d) * cos;
    g.projectiles.push({
      x: p.x + fx * 20, y: p.y + fy * 20,
      vx: fx * w.speed, vy: fy * w.speed,
      speed: w.speed, damage: w.damage, range: w.range,
      dist: 0, pierce: w.pierce, radius: 7, color: w.color,
      owner: p.id,
      // Burn applied per hit in projectiles.js via statusOnHit.
      statusOnHit: { type: 'burn', remaining: 3.0, magnitude: 8, tickRate: 0.5 },
    });
  }
}

// Iterates every alive player and their weapons. Cooldowns + fire
// dispatch + always-on per-type ticks (orbit, shield, lightning_field,
// meteor_orbit, fortress, thunder_god field).
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
      if (w.type === 'inferno_wheel') tickInfernoWheel(g, w, p, dt);
      if (w.type === 'tesla_aegis') tickTeslaAegis(g, w, p, dt);
    }
  }
}

function tickOrbit(g, w, p, dt) {
  w.phase = (w.phase || 0) + w.rotSpeed * dt;
  const effectiveRadius = w.radius * (p.sizeMulti || 1);
  for (let b = 0; b < w.bladeCount; b++) {
    const angle = w.phase + (b * Math.PI * 2 / w.bladeCount);
    const bx = p.x + Math.cos(angle) * effectiveRadius;
    const by = p.y + Math.sin(angle) * effectiveRadius;
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
  const effectiveRadius = w.radius * (p.sizeMulti || 1);
  let hit = false;
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const edx = e.x - p.x, edy = e.y - p.y;
    const dist = Math.hypot(edx, edy);
    if (dist < effectiveRadius + e.radius && dist > 1) {
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
  const effectiveRadius = w.radius * (p.sizeMulti || 1);
  const zapCount = w.zapCount + (p.projectileBonus || 0);
  const targets = randomEnemiesInRange(g, p.x, p.y, effectiveRadius, zapCount);
  for (const t of targets) {
    damageEnemy(g, t, w.damage * p.damageMulti, p.id);
    applyStatus(g, t, { type: 'slow', remaining: 1.5, magnitude: 0.4, tickRate: 0 });
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
  const effectiveRadius = w.radius * (p.sizeMulti || 1);
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const edx = p.x - e.x, edy = p.y - e.y;
    const dist = Math.hypot(edx, edy);
    if (dist < effectiveRadius + e.radius) {
      damageEnemy(g, e, w.damage * p.damageMulti * dt, p.id);
    }
  }
}

function tickChargeSweep(g, w, p, dt) {
  const cdx = w.chargeDx, cdy = w.chargeDy;
  const effectiveWidth = w.width * (p.sizeMulti || 1);
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const ex = e.x - p.x, ey = e.y - p.y;
    const forward = ex * cdx + ey * cdy;
    const lateral = Math.abs(ex * (-cdy) + ey * cdx);
    if (forward > -effectiveWidth && forward < w.speed * w.duration && lateral < effectiveWidth + e.radius) {
      damageEnemy(g, e, w.damage * p.damageMulti * dt * 3, p.id);
    }
  }
}

function tickDragonStormAura(g, w, p, dt) {
  const effectiveAura = w.auraRadius * (p.sizeMulti || 1);
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j];
    const dx = p.x - e.x, dy = p.y - e.y;
    if (dx * dx + dy * dy < (effectiveAura + e.radius) ** 2) {
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
  // Every `overchargeEvery`th fire hits everyone in range at 2x and
  // stuns — a rhythmic crowd-wipe that makes the weapon feel climactic.
  const overcharge = w.fireCount > 0 && w.fireCount % w.overchargeEvery === 0;
  if (overcharge) {
    const effectiveFieldR = w.fieldRadius * (p.sizeMulti || 1);
    let any = false;
    for (const e of g.enemies) {
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy >= effectiveFieldR * effectiveFieldR) continue;
      any = true;
      damageEnemy(g, e, w.fieldDamage * 2 * p.damageMulti, p.id);
      e.stunTimer = Math.max(e.stunTimer || 0, 0.3);
    }
    if (any) emit(g, EVT.CHAIN_ZAP, { weapon: 'thunder_god_overcharge', pid: p.id });
    return;
  }
  const effectiveFieldR2 = w.fieldRadius * (p.sizeMulti || 1);
  const tgZapCount = w.zapCount + (p.projectileBonus || 0);
  const targets = randomEnemiesInRange(g, p.x, p.y, effectiveFieldR2, tgZapCount);
  for (const t of targets) {
    damageEnemy(g, t, w.fieldDamage * p.damageMulti, p.id);
    g.chainEffects.push({ points: [{ x: p.x, y: p.y }, { x: t.x, y: t.y }], life: 0.15, color: w.color });
  }
  if (targets.length > 0) emit(g, EVT.CHAIN_ZAP, { weapon: 'thunder_god', pid: p.id });
}

// --- Meteor Orbit ---
// Big meteor on cooldown is identical to fireMeteor — same field names
// (damage, blastRadius). Mini-meteors are per-blade-kill in tickMeteorOrbit.

function tickMeteorOrbit(g, w, p, dt) {
  w.phase = (w.phase || 0) + w.rotSpeed * dt;
  const effectiveRadius = w.radius * (p.sizeMulti || 1);
  for (let b = 0; b < w.bladeCount; b++) {
    const angle = w.phase + (b * Math.PI * 2 / w.bladeCount);
    const bx = p.x + Math.cos(angle) * effectiveRadius;
    const by = p.y + Math.sin(angle) * effectiveRadius;
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
  const effectiveRadius = w.shieldRadius * (p.sizeMulti || 1);
  let hit = false;
  for (const e of g.enemies) {
    const edx = e.x - p.x, edy = e.y - p.y;
    const dist = Math.hypot(edx, edy);
    if (dist < effectiveRadius + e.radius && dist > 1) {
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
  const effectiveShockR = w.shockwaveRadius * (p.sizeMulti || 1);
  for (const e of g.enemies) {
    const dx = e.x - p.x, dy = e.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < effectiveShockR + e.radius) {
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
  emit(g, EVT.METEOR_EXPLODE, { x: p.x, y: p.y, color: w.color, radius: w.shockwaveRadius, pid: p.id });
}

// --- Inferno Wheel ---
// Breath + Orbit fusion. Orbit-style rotating blades with a much larger
// contact radius (so it reads as fire, not a precise blade) and a burn
// on every hit. Damage scaling matches orbit (× dt × 8) so it tunes the
// same way.
function tickInfernoWheel(g, w, p, dt) {
  w.phase = (w.phase || 0) + w.rotSpeed * dt;
  const effectiveOrbitR = w.radius * (p.sizeMulti || 1);
  const effectiveBladeR = w.bladeRadius * (p.sizeMulti || 1);
  const bladeCount = w.bladeCount + (p.projectileBonus || 0);
  for (let b = 0; b < bladeCount; b++) {
    const angle = w.phase + (b * Math.PI * 2 / bladeCount);
    const bx = p.x + Math.cos(angle) * effectiveOrbitR;
    const by = p.y + Math.sin(angle) * effectiveOrbitR;
    for (let j = g.enemies.length - 1; j >= 0; j--) {
      const e = g.enemies[j];
      const dx = bx - e.x, dy = by - e.y;
      if (dx * dx + dy * dy < (effectiveBladeR + e.radius) ** 2) {
        damageEnemy(g, e, w.bladeDamage * p.damageMulti * dt * 8, p.id);
        applyStatus(g, e, { type: 'burn', remaining: w.burnDuration, magnitude: w.burnDps, tickRate: 0.5 });
      }
    }
  }
}

// --- Tesla Aegis ---
// Chain + Shield fusion. Always-on knockback shield that also pulses a
// chain zap every pulseCooldown. Shield tick mirrors tickFortressShield;
// pulse mirrors fireChain but with a slow status on every link. The
// pulseTimer is independent of w.timer so the shield's `cooldown:99999`
// never blocks the pulse cadence.
function tickTeslaAegis(g, w, p, dt) {
  w.phase = (w.phase || 0) + dt * 4;
  w.pulsePhase = (w.pulsePhase || 0) + dt * 6;

  const effectiveRadius = w.shieldRadius * (p.sizeMulti || 1);
  let hit = false;
  for (const e of g.enemies) {
    const edx = e.x - p.x, edy = e.y - p.y;
    const dist = Math.hypot(edx, edy);
    if (dist < effectiveRadius + e.radius && dist > 1) {
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

  w.pulseTimer = (w.pulseTimer || 0) - dt;
  if (w.pulseTimer <= 0) {
    w.pulseTimer = w.pulseCooldown;
    fireTeslaAegisPulse(g, w, p);
  }
}

function fireTeslaAegisPulse(g, w, p) {
  w.pulseCount = (w.pulseCount || 0) + 1;
  const overcharge = w.pulseCount > 0 && w.pulseCount % w.overchargeEvery === 0;
  if (overcharge) {
    const expandR = w.overchargeExpandR * (p.sizeMulti || 1);
    for (const e of g.enemies) {
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy >= expandR * expandR) continue;
      damageEnemy(g, e, w.chainDamage * 2 * p.damageMulti, p.id);
      e.stunTimer = Math.max(e.stunTimer || 0, w.overchargeStun);
      applyStatus(g, e, { type: 'slow', remaining: 1.5, magnitude: 0.4, tickRate: 0 });
    }
    // Expanding ring read — reuse the meteor 'explode' phase since it
    // already draws a ring that fades out, and it carries its own
    // color field so it reads blue here instead of the usual orange.
    g.meteorEffects.push({
      x: p.x, y: p.y, radius: expandR,
      damage: 0, life: w.overchargeExpandLife, phase: 'explode',
      color: w.color, owner: p.id,
    });
    emit(g, EVT.CHAIN_ZAP, { weapon: 'tesla_aegis_overcharge', pid: p.id });
    return;
  }

  const effectiveRange = w.chainRange * (p.sizeMulti || 1);
  const chainCount = w.chains + (p.projectileBonus || 0);
  const hitSet = new Set();
  let prevX = p.x, prevY = p.y;
  const points = [{ x: p.x, y: p.y }];
  let nextRange = effectiveRange;
  for (let i = 0; i < chainCount; i++) {
    let nearest = null, nearestDist = nextRange;
    for (const e of g.enemies) {
      if (hitSet.has(e)) continue;
      const d = Math.hypot(e.x - prevX, e.y - prevY);
      if (d < nearestDist) { nearest = e; nearestDist = d; }
    }
    if (!nearest) break;
    hitSet.add(nearest);
    damageEnemy(g, nearest, w.chainDamage * p.damageMulti, p.id);
    applyStatus(g, nearest, { type: 'slow', remaining: 1.5, magnitude: 0.4, tickRate: 0 });
    points.push({ x: nearest.x, y: nearest.y });
    prevX = nearest.x; prevY = nearest.y;
    // Tighter falloff after the first hop so chains wrap the shield
    // rather than reaching across the screen.
    nextRange = w.chainRange * 0.6;
  }
  if (points.length > 1) {
    g.chainEffects.push({ points, life: 0.2, color: w.color });
    emit(g, EVT.CHAIN_ZAP, { weapon: 'tesla_aegis', pid: p.id });
  }
}

// --- chain + meteor effect lifetimes ---
export function updateChainEffects(g, dt) {
  for (let i = g.chainEffects.length - 1; i >= 0; i--) {
    g.chainEffects[i].life -= dt;
    if (g.chainEffects[i].life <= 0) g.chainEffects.splice(i, 1);
  }
}

// Charge fire-wake trails. Lingering damage zones left behind a Bull
// Rush dash. Enemies walking through take half charge damage per tick
// for 1 second. Rewards aggressive pathing through enemy packs.
export function updateChargeTrails(g, dt) {
  if (!g.chargeTrails) return;
  for (let i = g.chargeTrails.length - 1; i >= 0; i--) {
    const t = g.chargeTrails[i];
    t.life -= dt;
    if (t.life <= 0) { g.chargeTrails.splice(i, 1); continue; }
    // Damage enemies overlapping this zone — per-tick dot, not burst.
    for (const e of g.enemies) {
      if (e.dying !== undefined) continue;
      const dx = e.x - t.x, dy = e.y - t.y;
      if (dx * dx + dy * dy < (t.radius + e.radius) ** 2) {
        damageEnemy(g, e, t.damage * dt, t.owner);
      }
    }
  }
}

export function updateMeteorEffects(g, dt) {
  for (let i = g.meteorEffects.length - 1; i >= 0; i--) {
    const m = g.meteorEffects[i];
    m.life -= dt;
    if (m.phase === 'warn' && m.life <= 0) {
      m.phase = 'explode';
      m.life = 0.3;
      emit(g, EVT.METEOR_EXPLODE, { x: m.x, y: m.y, color: m.color, radius: m.radius, pid: m.owner });
      for (let j = g.enemies.length - 1; j >= 0; j--) {
        const e = g.enemies[j];
        const dx = m.x - e.x, dy = m.y - e.y;
        if (dx * dx + dy * dy < (m.radius + e.radius) ** 2) {
          damageEnemy(g, g.enemies[j], m.damage, m.owner);
          // Meteor freeze — hard landing stuns enemies in the blast zone.
          if (m.damage > 0) applyStatus(g, e, { type: 'freeze', remaining: 0.8, magnitude: 0, tickRate: 0 });
        }
      }
    } else if (m.phase === 'explode' && m.life <= 0) {
      g.meteorEffects.splice(i, 1);
    }
  }
}
