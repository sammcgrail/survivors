// Shared canvas-render helpers used by both SP (src/main.js) and MP
// (src/mp-main.js). Each helper takes its own ctx so callers don't
// need to share state; no module-level canvas / state references.
//
// The SP/MP unification roadmap is complete — everything that's
// shareable between the two entry points lives here. Remaining MP-only
// by design: the "YOU" arrow, level badge, per-player name coloring
// (Tier A in the disparity plan — intentional divergence).
//
// `renderWorld(ctx, view, drawSprite, particles, viewport, opts)` is
// the single entry point for the shared middle of both pipelines —
// gems → hearts → auras → enemies → projectiles. Callers wrap it
// with background + obstacles before, and chain/meteor/players/
// particles after (players diverge; chain/meteor sit after so SP's
// charge trail can slot in between).
//
// Renderers treat their arguments as read-only. One carve-out is
// drawProjectiles, which spawns ember particles into a passed-in
// array for SP's visual trail — documented at the call site.

import { SP, SPRITE_SIZE } from './sprites.js';

// Bind a drawSprite() to a specific canvas + sheet. SP and MP each
// build one at module load. Returns false if the sheet hasn't loaded
// or the sprite name is unknown — caller draws a fallback.
export function makeDrawSprite(ctx, sheet, isReadyFn) {
  return function drawSprite(name, x, y, scale, alpha) {
    if (!isReadyFn() || !SP[name]) return false;
    const sp = SP[name];
    const s = SPRITE_SIZE;
    const drawSize = s * (scale || 2);
    const half = drawSize * 0.5;
    if (alpha !== undefined) {
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sheet, sp[0] * s, sp[1] * s, s, s, x - half, y - half, drawSize, drawSize);
      ctx.globalAlpha = prev;
    } else {
      ctx.drawImage(sheet, sp[0] * s, sp[1] * s, s, s, x - half, y - half, drawSize, drawSize);
    }
    return true;
  };
}

// Pre-sprite cosmetic auras — shadow-skin radial gradient + gold-skin
// shimmer ring. `alpha` lets SP fade these during iframe flicker; MP
// passes 1 since it doesn't track iframes per peer.
export function drawSkinAura(ctx, x, y, radius, skin, time, alpha = 1) {
  if (skin === 'skin_shadow') {
    ctx.save();
    ctx.globalAlpha = 0.3 * alpha;
    const auraR = radius * 2.2;
    const grad = ctx.createRadialGradient(x, y, radius * 0.5, x, y, auraR);
    grad.addColorStop(0, 'rgba(155, 89, 182, 0.5)');
    grad.addColorStop(1, 'rgba(44, 0, 62, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, auraR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (skin === 'skin_gold') {
    ctx.save();
    ctx.globalAlpha = (0.25 + 0.1 * Math.sin(time * 4)) * alpha;
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// HP bar, top-left at (x - w/2, yTop). Color flips red below 30%.
// Caller passes height + bg (defaults are the common 4×#222 player bar).
export function drawHpBar(ctx, x, yTop, w, hpFrac, height = 4, bg = '#222') {
  ctx.fillStyle = bg;
  ctx.fillRect(x - w / 2, yTop, w, height);
  ctx.fillStyle = hpFrac > 0.3 ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(x - w / 2, yTop, w * Math.max(0, hpFrac), height);
}

// Decorative-only fading particles: alpha + radius shrink with life.
export function drawParticles(ctx, particles) {
  for (const pt of particles) {
    const t = pt.life / pt.maxLife;
    ctx.globalAlpha = t;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.radius * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Most enemy `name` values match their sprite name. Ghost is the only
// outlier (uses the skull sprite). Used by drawEnemies when an enemy
// snapshot lacks an explicit `sprite` field (server doesn't ship it).
const ENEMY_NAME_TO_SPRITE = { ghost: 'skull' };

// Render a list of enemies — handles dying-animation shrink + fade,
// hit-flash white overlay, sprite + colored-circle fallback, and the
// HP bar. Viewport-culled by (cx,cy,W,H) so off-screen enemies skip.
//
// Optional `onSeen(name)` is called once per visible non-dying enemy
// — SP wires this to the bestiary discovery hook so playing
// continuously builds out the catalog.
export function drawEnemies(ctx, enemies, drawSprite, cx, cy, W, H, onSeen) {
  for (const e of enemies) {
    if (e.x < cx - 50 || e.x > cx + W + 50 || e.y < cy - 50 || e.y > cy + H + 50) continue;
    const spriteName = e.sprite || ENEMY_NAME_TO_SPRITE[e.name] || e.name;

    if (e.dying !== undefined) {
      const t = e.dying / 0.2;
      const dyingScale = (0.3 + t * 0.7) * (e.radius / 8);
      if (!drawSprite(spriteName, e.x, e.y, dyingScale, t)) {
        const prev = ctx.globalAlpha;
        ctx.globalAlpha = t;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius * (0.3 + t * 0.7), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = prev;
      }
      continue;
    }

    if (onSeen) onSeen(e.name);

    if (!drawSprite(spriteName, e.x, e.y, e.radius / 8)) {
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(e.hitFlash * 5, 0.6)})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    if (e.hp < e.maxHp) {
      drawHpBar(ctx, e.x, e.y - e.radius - 8, e.radius * 2, e.hp / e.maxHp, 3, '#300');
    }
  }
}

// Render a list of projectiles — 4-step trail sprites + main projectile
// sprite with shadow glow, colored-circle fallback. If `particles` is
// passed, drops occasional embers behind each projectile so the trail
// reads through the sprite at high speed.
export function drawProjectiles(ctx, projectiles, drawSprite, particles, cx, cy, W, H) {
  for (const proj of projectiles) {
    if (proj.x < cx - 30 || proj.x > cx + W + 30 || proj.y < cy - 30 || proj.y > cy + H + 30) continue;
    const speed = Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);
    if (speed > 0) {
      const nx = -proj.vx / speed;
      const ny = -proj.vy / speed;
      for (let t = 1; t <= 4; t++) {
        const alpha = 0.3 - t * 0.06;
        const tScale = (1 - t * 0.15) * 0.7;
        const tx = proj.x + nx * t * 6;
        const ty = proj.y + ny * t * 6;
        if (!drawSprite('spitTrail', tx, ty, tScale, alpha)) {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = proj.color;
          ctx.beginPath();
          ctx.arc(tx, ty, proj.radius * (1 - t * 0.15), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.shadowColor = proj.color;
    ctx.shadowBlur = 10;
    if (!drawSprite('spit', proj.x, proj.y, 0.7)) {
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    // Renderer-as-writer carve-out: we mutate the passed-in particles
    // array. The alternative (sim events for ember spawn) would ship
    // cosmetic noise across the wire for every MP client, which isn't
    // worth the bytes. Particles are transient + local per client.
    if (particles && Math.random() < 0.4) {
      particles.push({
        x: proj.x + (Math.random() - 0.5) * 4,
        y: proj.y + (Math.random() - 0.5) * 4,
        vx: 0, vy: 0,
        life: 0.25, maxLife: 0.25,
        radius: 1.5 + Math.random(),
        color: proj.color,
      });
    }
  }
}

// Chain-lightning effects — two passes per bolt (thick translucent
// outer glow + thin bright inner core), two jagged midpoints per
// segment so the bolts read as proper electric arcs. Used for chain
// weapon, lightning_field, thunder_god, fortress shockwave reuse.
export function drawChainEffects(ctx, chainEffects) {
  for (const ce of chainEffects) {
    const t = ce.life / 0.2;
    ctx.shadowColor = ce.color;
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass === 0 ? 6 : 2;
      ctx.strokeStyle = pass === 0 ? ce.color : '#ffffff';
      ctx.shadowBlur = pass === 0 ? 14 : 6;
      ctx.globalAlpha = pass === 0 ? t * 0.45 : t;
      for (let i = 0; i < ce.points.length - 1; i++) {
        const a = ce.points[i];
        const b = ce.points[i + 1];
        const dx = (b.x - a.x), dy = (b.y - a.y);
        const m1x = a.x + dx * 0.33 + (Math.random() - 0.5) * 18;
        const m1y = a.y + dy * 0.33 + (Math.random() - 0.5) * 18;
        const m2x = a.x + dx * 0.66 + (Math.random() - 0.5) * 18;
        const m2y = a.y + dy * 0.66 + (Math.random() - 0.5) * 18;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(m1x, m1y);
        ctx.lineTo(m2x, m2y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// Meteor warn + explode effects — falling streak above the warn ring,
// dashed warn circle + pulsing center, expanding ring on explode.
// Reused by meteor + meteor_orbit + fortress shockwave + enemy death
// rings (all push to g.meteorEffects with the same shape).
export function drawMeteorEffects(ctx, meteorEffects) {
  for (const m of meteorEffects) {
    if (m.phase === 'warn') {
      // Falling streak from off-screen down to the warn ring — sells
      // the "something's coming" beat before the explosion.
      const t = 1 - (m.life / 0.5);
      const streakStart = m.y - 480 * (1 - t);
      const grad = ctx.createLinearGradient(m.x, streakStart, m.x, m.y);
      grad.addColorStop(0,   'rgba(255, 99, 72, 0)');
      grad.addColorStop(0.7, 'rgba(255, 150, 80, 0.4)');
      grad.addColorStop(1,   'rgba(255, 220, 100, 0.9)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 6 * t + 2;
      ctx.beginPath();
      ctx.moveTo(m.x, streakStart);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 99, 72, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255, 99, 72, ${0.1 + Math.sin(m.life * 20) * 0.1})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const t = m.life / 0.3;
      ctx.fillStyle = `rgba(255, 99, 72, ${t * 0.4})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius * (2 - t), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Per-weapon aura visuals that sit on top of the player. Reads live
// sim fields from each weapon — the MP server ships phase/pulsePhase/
// fireCount/active/chargeDx/Dy/color on the snapshot so MP renders
// identically to SP (vs. the old MP code which faked phase from
// gameTime and hardcoded colors).
//
// Applies sizeMulti + projectileBonus at render time so SP (raw
// w.radius) and MP (snapshot w.radius) both end up at the actual
// effective damage-zone size under Amplify/Volley upgrades.
//
// Charge-weapon dash trail lives in drawChargeTrail (runs after
// projectiles so the streak sits on top); this helper handles the
// 8 persistent weapon auras only.
//
// `viewport` is optional — {cx, cy, W, H}; when provided, cull
// players whose entire largest possible aura can't hit the viewport.
// 300px margin covers thunder_god @ max sizeMulti. SP has at most
// one player so the cull is a no-op; MP at 8 players gets a real
// perf win.
export function drawWeaponAuras(ctx, players, time, viewport) {
  const vx = viewport?.cx, vy = viewport?.cy, vw = viewport?.W, vh = viewport?.H;
  const cull = viewport !== undefined;
  for (const p of players) {
    if (!p.alive) continue;
    if (cull && (p.x < vx - 300 || p.x > vx + vw + 300 || p.y < vy - 300 || p.y > vy + vh + 300)) continue;
    const sm = p.sizeMulti || 1;
    const pb = p.projectileBonus || 0;
    for (const w of (p.weapons || [])) {
      if (w.type === 'breath') {
        const pp = w.pulsePhase || 0;
        const r = w.radius * sm * (1 + Math.sin(pp) * 0.12);
        const grad = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
        grad.addColorStop(0,   'rgba(255, 200, 90, 0.30)');
        grad.addColorStop(0.5, 'rgba(230, 126, 34, 0.16)');
        grad.addColorStop(1,   'rgba(231,  76, 60, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        const wavePhase = (pp * 0.5) % 1;
        ctx.strokeStyle = `rgba(255, 180, 90, ${0.4 * (1 - wavePhase)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (1 + wavePhase * 0.5), 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(230, 126, 34, 0.4)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#e67e22';
        for (let i = 0; i < 8; i++) {
          const a = pp * 0.7 + (Math.PI * 2 / 8) * i;
          const dotR = 3 + Math.sin(pp * 2 + i) * 1.5;
          ctx.globalAlpha = 0.6 + Math.sin(pp + i * 0.8) * 0.3;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      if (w.type === 'dragon_storm') {
        const pulse = 1 + Math.sin(w.pulsePhase || 0) * 0.1;
        const r = w.auraRadius * sm * pulse;
        const grad = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
        grad.addColorStop(0,   'rgba(243, 156, 18, 0.2)');
        grad.addColorStop(0.6, 'rgba(231,  76, 60, 0.1)');
        grad.addColorStop(1,   'rgba(231,  76, 60, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(243, 156, 18, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (w.type === 'orbit') {
        const phase = w.phase || 0;
        const orbitR = w.radius * sm;
        const count = w.bladeCount + pb;
        ctx.strokeStyle = w.color;
        ctx.lineWidth = 2;
        for (let b = 0; b < count; b++) {
          const angle = phase + (b * Math.PI * 2 / count);
          for (let t = 1; t <= 4; t++) {
            ctx.globalAlpha = 0.45 - t * 0.1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, orbitR, angle - 0.05 * t, angle - 0.05 * (t - 1));
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          const bx = p.x + Math.cos(angle) * orbitR;
          const by = p.y + Math.sin(angle) * orbitR;
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(angle + Math.PI / 2);
          ctx.fillStyle = w.color;
          ctx.shadowColor = w.color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(0, -10);
          ctx.lineTo(4, 4);
          ctx.lineTo(-4, 4);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }

      if (w.type === 'shield') {
        const ph = w.phase || 0;
        const r = w.radius * sm * (1 + Math.sin(ph) * 0.08);
        const grad = ctx.createRadialGradient(p.x, p.y, r * 0.7, p.x, p.y, r);
        grad.addColorStop(0,   'rgba(116, 185, 255, 0)');
        grad.addColorStop(0.8, 'rgba(116, 185, 255, 0.12)');
        grad.addColorStop(1,   'rgba(116, 185, 255, 0.25)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(116, 185, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(116, 185, 255, 0.8)';
        for (let h = 0; h < 6; h++) {
          const a = ph * 0.5 + (Math.PI * 2 / 6) * h;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (w.type === 'lightning_field') {
        const fr = w.radius * sm;
        if (Math.random() < 0.3) {
          const a1 = Math.random() * Math.PI * 2;
          const a2 = a1 + (Math.random() - 0.5) * 0.6;
          const r1 = fr * (0.3 + Math.random() * 0.6);
          const r2 = fr * (0.3 + Math.random() * 0.6);
          ctx.strokeStyle = 'rgba(255, 234, 167, 0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(a1) * r1, p.y + Math.sin(a1) * r1);
          ctx.lineTo(p.x + Math.cos(a2) * r2, p.y + Math.sin(a2) * r2);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255, 234, 167, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, fr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (w.type === 'thunder_god') {
        const tr = w.fieldRadius * sm;
        const fc = w.fireCount || 0;
        const overchargeReady = fc > 0 && (fc + 1) % 4 === 0;
        const a = 0.05 + Math.sin(time * 8) * 0.025;
        ctx.fillStyle = overchargeReady ? `rgba(255, 255, 255, ${a * 2})` : `rgba(0, 210, 211, ${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, tr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = overchargeReady ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 210, 211, 0.3)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, tr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (w.type === 'meteor_orbit') {
        const orbitR = w.radius * sm;
        const count = w.bladeCount + pb;
        for (let b = 0; b < count; b++) {
          const angle = (w.phase || 0) + (b * Math.PI * 2 / count);
          const bx = p.x + Math.cos(angle) * orbitR;
          const by = p.y + Math.sin(angle) * orbitR;
          for (let t = 1; t <= 3; t++) {
            const ta = angle - t * 0.1;
            const tx = p.x + Math.cos(ta) * orbitR;
            const ty = p.y + Math.sin(ta) * orbitR;
            ctx.globalAlpha = 0.3 / t;
            ctx.fillStyle = '#ff6348';
            ctx.beginPath();
            ctx.arc(tx, ty, 4 - t, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(angle + Math.PI / 2);
          ctx.fillStyle = w.color;
          ctx.shadowColor = w.color;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(0, -14);
          ctx.lineTo(6, 6);
          ctx.lineTo(-6, 6);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }

      if (w.type === 'fortress') {
        const ph = w.phase || 0;
        const r = w.shieldRadius * sm * (1 + Math.sin(ph) * 0.08);
        const grad = ctx.createRadialGradient(p.x, p.y, r * 0.7, p.x, p.y, r);
        grad.addColorStop(0,   'rgba(116, 185, 255, 0)');
        grad.addColorStop(0.8, 'rgba(116, 185, 255, 0.18)');
        grad.addColorStop(1,   'rgba(116, 185, 255, 0.35)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(116, 185, 255, 0.8)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let h = 0; h < 6; h++) {
          const a = ph * 0.3 + (Math.PI * 2 / 6) * h;
          const x = p.x + Math.cos(a) * r;
          const y = p.y + Math.sin(a) * r;
          if (h === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        if (w.active) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - w.chargeDx * 80, p.y - w.chargeDy * 80);
          ctx.stroke();
        }
      }
    }
  }
}

// Gem render: sprite when loaded, blue diamond fallback. Fallback
// radius defaults to 6 (MP snapshot omits radius); SP passes
// gem.radius for sim-side visuals.
export function drawGem(ctx, gem, drawSprite, fallbackRadius = 6) {
  if (drawSprite('gem', gem.x, gem.y, 0.9, 0.85)) return;
  const r = gem.radius || fallbackRadius;
  ctx.fillStyle = '#3498db';
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(gem.x, gem.y - r);
  ctx.lineTo(gem.x + r, gem.y);
  ctx.lineTo(gem.x, gem.y + r);
  ctx.lineTo(gem.x - r, gem.y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Heart pickups — sprite with bob + late-life fade, triangle-rounded
// heart-shape fallback. Viewport-culled (20px margin).
export function drawHeartDrops(ctx, heartDrops, drawSprite, cx, cy, W, H) {
  for (const h of heartDrops) {
    if (h.x < cx - 20 || h.x > cx + W + 20 || h.y < cy - 20 || h.y > cy + H + 20) continue;
    const bob = Math.sin(h.bobPhase) * 3;
    const fadeAlpha = h.life < 3 ? h.life / 3 : 1;
    ctx.globalAlpha = fadeAlpha;
    if (!drawSprite('heart', h.x, h.y + bob, 0.8, fadeAlpha)) {
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(h.x - 4, h.y + bob - 2, 5, 0, Math.PI * 2);
      ctx.arc(h.x + 4, h.y + bob - 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(h.x - 9, h.y + bob);
      ctx.lineTo(h.x, h.y + bob + 8);
      ctx.lineTo(h.x + 9, h.y + bob);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// Player body — skin glow + shadow + sprite with skin-tint overlay,
// fallback circle. Auto-flickers on iframes when p.iframes > 0 and
// flashes shadow white for the hit feedback. Caller handles name/
// HP/decorations since those differ between SP (single player +
// facing) and MP (name + isMe arrow + level badge).
//
// `opts` fields:
//   skin, alpha, radius, glowColor, fallbackFill, strokeOnFallback
export function drawPlayerBody(ctx, p, drawSprite, time, opts = {}) {
  const {
    skin,
    alpha = 1,
    radius = 14,
    glowColor = '#3498db',
    fallbackFill = '#eee',
    strokeOnFallback = true,
  } = opts;
  const iframes = p.iframes || 0;
  const flickerHide = iframes > 0 && Math.floor(iframes * 10) % 2;
  const effAlpha = flickerHide ? alpha * 0.4 : alpha;

  ctx.shadowColor = iframes > 0 ? '#fff' : glowColor;
  ctx.shadowBlur = opts.shadowBlur !== undefined
    ? opts.shadowBlur
    : (skin === 'skin_shadow' ? 25 : 15);

  drawSkinAura(ctx, p.x, p.y, radius, skin, time, effAlpha);

  const drawn = drawSprite('player', p.x, p.y, 2, effAlpha);
  if (drawn && skin) {
    const tintColor = skin === 'skin_gold' ? 'rgba(241, 196, 15, 0.35)'
                    : skin === 'skin_shadow' ? 'rgba(100, 30, 150, 0.4)'
                    : null;
    if (tintColor) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = tintColor;
      ctx.fillRect(p.x - 16, p.y - 16, 32, 32);
      ctx.restore();
    }
  }
  if (!drawn) {
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = effAlpha;
    ctx.fillStyle = fallbackFill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (strokeOnFallback) {
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = prev;
  }
  ctx.shadowBlur = 0;
}

// Facing indicator — small triangle pointing in p.facing direction.
// No-op when facing is missing (peer at rest, or pre-snapshot SP
// ticks). Auto-matches the iframe flicker from drawPlayerBody so the
// indicator fades on the same frames as the body.
export function drawFacingIndicator(ctx, p, color, radius = 14) {
  if (!p.facing) return;
  const fd = Math.sqrt(p.facing.x ** 2 + p.facing.y ** 2);
  if (fd < 0.01) return;
  const iframes = p.iframes || 0;
  const flickerHide = iframes > 0 && Math.floor(iframes * 10) % 2;
  const fx = p.facing.x / fd;
  const fy = p.facing.y / fd;
  const perpX = -fy;
  const perpY = fx;
  ctx.fillStyle = color;
  ctx.globalAlpha = flickerHide ? 0.4 : 1;
  ctx.beginPath();
  ctx.moveTo(p.x + fx * (radius + 6), p.y + fy * (radius + 6));
  ctx.lineTo(p.x + fx * radius - perpX * 4, p.y + fy * radius - perpY * 4);
  ctx.lineTo(p.x + fx * radius + perpX * 4, p.y + fy * radius + perpY * 4);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Single entry point for the shared middle of the render pipeline.
// Draws gems → hearts → weapon auras → enemies → projectiles in the
// order both entry points need them. Caller handles background +
// obstacles before this and chain/meteor/players/particles after.
//
// `view` matches the shape declared in shared/view.js: { time,
// players, enemies, projectiles, gems, heartDrops, ... }. SP
// synthesizes it from `g` via synthesizeView; MP passes the server
// snapshot directly.
//
// `viewport` is { cx, cy, W, H } for culling. `opts.onSeen(name)` is
// optional — SP wires it to the bestiary discovery hook.
export function renderWorld(ctx, view, drawSprite, particles, viewport, opts = {}) {
  const { cx, cy, W, H } = viewport;
  for (const gem of view.gems) {
    if (gem.x < cx - 20 || gem.x > cx + W + 20 || gem.y < cy - 20 || gem.y > cy + H + 20) continue;
    drawGem(ctx, gem, drawSprite);
  }
  drawHeartDrops(ctx, view.heartDrops || [], drawSprite, cx, cy, W, H);
  drawWeaponAuras(ctx, view.players, view.time || 0, viewport);
  drawEnemies(ctx, view.enemies, drawSprite, cx, cy, W, H, opts.onSeen);
  drawProjectiles(ctx, view.projectiles, drawSprite, particles, cx, cy, W, H);
}

// Charge weapon dash trail — tapered streak + speed lines + slash arc
// for players whose charge weapon is currently mid-dash. Reads
// w.speed / w.duration / w.chargeTimer / w.width / w.chargeDx,Dy /
// w.color from each active charge. Caller slots this between
// drawProjectiles and drawChainEffects so the trail reads on top of
// hits but under chain/meteor FX (matches SP's pre-unification
// order).
export function drawChargeTrail(ctx, players) {
  for (const p of players) {
    if (!p.alive) continue;
    for (const w of (p.weapons || [])) {
      if (w.type !== 'charge' || !w.active) continue;
      const trailDist = w.speed * w.duration;
      const progress = 1 - (w.chargeTimer / w.duration);
      const perpX = -w.chargeDy;
      const perpY = w.chargeDx;

      ctx.save();
      ctx.fillStyle = w.color;
      const steps = 10;
      for (let t = steps; t >= 0; t--) {
        const frac = t / steps;
        ctx.globalAlpha = 0.35 * (1 - frac);
        ctx.beginPath();
        ctx.arc(
          p.x - w.chargeDx * trailDist * frac,
          p.y - w.chargeDy * trailDist * frac,
          w.width * (1 - frac * 0.6),
          0, Math.PI * 2,
        );
        ctx.fill();
      }

      ctx.strokeStyle = w.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const offset = (i + 1) * 0.2;
        const spread = (i % 2 === 0 ? 1 : -1) * (8 + i * 6);
        const sx = p.x - w.chargeDx * trailDist * offset + perpX * spread;
        const sy = p.y - w.chargeDy * trailDist * offset + perpY * spread;
        const lineLen = 12 + i * 4;
        ctx.globalAlpha = 0.4 * (1 - offset);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - w.chargeDx * lineLen, sy - w.chargeDy * lineLen);
        ctx.stroke();
      }

      ctx.globalAlpha = 0.5 * (1 - progress);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      const slashAngle = Math.atan2(w.chargeDy, w.chargeDx);
      ctx.beginPath();
      ctx.arc(p.x, p.y, w.width * 1.5, slashAngle - 0.8, slashAngle + 0.8);
      ctx.stroke();
      ctx.restore();
    }
  }
}
