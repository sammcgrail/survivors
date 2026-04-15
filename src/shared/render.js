// Shared canvas-render helpers used by both SP (src/main.js) and MP
// (src/mp-main.js). Each helper takes its own ctx so callers don't
// need to share state; no module-level canvas / state references.
//
// Roadmap (from the unification plan): blocks migrate here one batch
// at a time. Already shared: drawSprite (factory), drawGem, drawSkinAura,
// drawHpBar, drawParticles, drawChainEffects, drawMeteorEffects.
// Pending: enemies, projectiles, weapon auras, player base.

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
