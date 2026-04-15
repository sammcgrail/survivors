// Shared canvas-render helpers used by both SP (src/main.js) and MP
// (src/mp-main.js). Tier 1 of the SP/MP render dedupe — only the
// byte-identical or trivially-parameterized blocks live here. Weapon
// auras, enemy renders, and chain/meteor effects stay per-client
// because the underlying data shapes differ between SP (live sim
// objects) and MP (snapshot strings).
//
// Each helper takes its own ctx so callers don't need to share state;
// no module-level canvas / state references.

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
