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

// Decorative-only floating text — fade alpha with remaining life.
// Sim events push these (damage numbers, pickup labels); ticker
// advances y via ft.vy in the update loop.
export function drawFloatingTexts(ctx, floatingTexts) {
  ctx.font = 'bold 12px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  for (const ft of floatingTexts) {
    ctx.globalAlpha = ft.life / ft.maxLife;
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;
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
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
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
      drawEnemyFallback(ctx, e, now);
    }
    if (e.hitFlash > 0) {
      drawHitFlashLayers(ctx, e);
    }

    // Status tint — persistent overlay while a status is active.
    // STATUS_APPLIED particle pop fires once on apply (in the event
    // channel); this layer keeps the visual up so players reading
    // the battlefield can tell which enemies are slowed/burning/
    // frozen at a glance instead of having to remember.
    if (e.statusEffects && e.statusEffects.length > 0) {
      drawStatusTint(ctx, e);
    }

    if (e.hp < e.maxHp) {
      drawHpBar(ctx, e.x, e.y - e.radius - 8, e.radius * 2, e.hp / e.maxHp, 3, '#300');
    }
  }
}

// Fallback renderer for enemies without a sprite (poisoner / splitter /
// bomber / healer added after the original sprite sheet). Goes beyond a
// flat colored circle — outline ring + main fill + per-type animated
// detail so they read as distinct creatures. All detail is procedural
// against `performance.now()` + per-enemy offsets so there's no state
// per enemy and the call is O(1) per enemy.
function drawEnemyFallback(ctx, e, now) {
  const r = e.radius;
  // Outline ring — slightly darker than the fill, 1.5px wide.
  ctx.strokeStyle = shadeHex(e.color, -0.35);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.stroke();
  // Main fill.
  ctx.fillStyle = e.color;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r - 0.5, 0, Math.PI * 2);
  ctx.fill();

  if (e.name === 'poisoner') {
    // Shimmering spiky rim — 8 spikes that rotate and breathe, toxic feel.
    const t = now / 400 + e.x * 0.01;
    ctx.fillStyle = shadeHex(e.color, 0.35);
    for (let i = 0; i < 8; i++) {
      const a = t + (Math.PI * 2 * i) / 8;
      const spikeR = r + 1.5 + Math.sin(t * 2 + i) * 1.2;
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * spikeR, e.y + Math.sin(a) * spikeR, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (e.name === 'splitter') {
    // Lumpy body — 3 offset inner lobes that pulse, suggests it's
    // about to split.
    const t = now / 300 + e.x * 0.02;
    ctx.fillStyle = shadeHex(e.color, 0.2);
    for (let i = 0; i < 3; i++) {
      const a = t + (Math.PI * 2 * i) / 3;
      const offR = r * 0.45;
      const lobeR = r * (0.35 + Math.sin(t * 3 + i) * 0.08);
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * offR, e.y + Math.sin(a) * offR, lobeR, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (e.name === 'bomber') {
    // Ticking fuse dot — bright core that throbs faster as hp drops,
    // visual "it's about to explode" cue.
    const hpFrac = e.hp / e.maxHp;
    const tickRate = 220 - (1 - hpFrac) * 180; // throb faster at low hp
    const pulse = 0.55 + Math.sin(now / tickRate + e.x * 0.03) * 0.45;
    ctx.fillStyle = `rgba(255, 220, 120, ${pulse})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y - r * 0.15, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    // Fuse line running up from the top
    ctx.strokeStyle = 'rgba(120, 60, 30, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - r * 0.6);
    ctx.lineTo(e.x + Math.sin(now / 200) * 1.5, e.y - r * 1.1);
    ctx.stroke();
  } else if (e.name === 'healer') {
    // Cross-shaped inner glow + 4 orbiting motes. Reads as medical.
    const t = now / 500 + e.x * 0.008;
    ctx.fillStyle = 'rgba(220, 255, 235, 0.9)';
    const armR = r * 0.55;
    const armW = r * 0.18;
    ctx.fillRect(e.x - armW / 2, e.y - armR, armW, armR * 2);
    ctx.fillRect(e.x - armR, e.y - armW / 2, armR * 2, armW);
    ctx.fillStyle = 'rgba(220, 255, 235, 0.7)';
    for (let i = 0; i < 4; i++) {
      const a = t + (Math.PI * 2 * i) / 4;
      const orbR = r * 1.15;
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * orbR, e.y + Math.sin(a) * orbR, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Generic fallback — 1 inner highlight dot so even unnamed new
    // enemies pick up a hint of depth for free.
    ctx.fillStyle = shadeHex(e.color, 0.35);
    ctx.beginPath();
    ctx.arc(e.x - r * 0.25, e.y - r * 0.25, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Multi-stage hit flash. Was a single semi-opaque overlay. Now:
//   fresh hit  — bright core + radial crack streaks
//   mid decay  — dimmer overlay + fading streaks
//   tail       — last tint only
// Reads as a multi-frame response instead of a single fade.
function drawHitFlashLayers(ctx, e) {
  const hf = e.hitFlash;
  // Bright core — visible only fresh (first ~0.15s)
  if (hf > 0.6) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(hf * 0.9, 0.9)})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius * 0.8, 0, Math.PI * 2);
    ctx.fill();
    // 4 short crack streaks radiating out — only on fresh hits.
    ctx.strokeStyle = `rgba(255,255,255,${hf * 0.7})`;
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI * 2 * i) / 4 + (e.x * 0.03);
      const r0 = e.radius * 0.3;
      const r1 = e.radius * (0.95 + hf * 0.35);
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
      ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
      ctx.stroke();
    }
  } else {
    // Decay overlay only.
    ctx.fillStyle = `rgba(255,255,255,${Math.min(hf * 5, 0.5)})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Shift a #rrggbb color toward white (pct > 0) or black (pct < 0).
// Clamped. Used for outline/inner highlight tinting off the enemy's
// base color so every type keeps its identity.
function shadeHex(hex, pct) {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const target = pct >= 0 ? 255 : 0;
  const amt = Math.abs(pct);
  const rr = Math.round(r + (target - r) * amt);
  const gg = Math.round(g + (target - g) * amt);
  const bb = Math.round(b + (target - b) * amt);
  return `rgb(${rr},${gg},${bb})`;
}

// Per-status overlay drawn on top of the enemy sprite. Burn flickers
// orange (sin-driven so it reads as flames), slow gets a steady blue
// glow, freeze gets a cyan-white frost shell + 4 ice shards on the
// rim. Multiple statuses stack — burn over slow over freeze.
function drawStatusTint(ctx, e) {
  for (const s of e.statusEffects) {
    if (s.type === 'burn') {
      const flick = 0.3 + Math.sin(performance.now() / 80 + e.x * 0.05) * 0.15;
      ctx.fillStyle = `rgba(243, 156, 18, ${flick})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 0.95, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.type === 'slow') {
      ctx.fillStyle = 'rgba(52, 152, 219, 0.25)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 0.95, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.type === 'freeze') {
      ctx.fillStyle = 'rgba(173, 216, 230, 0.45)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 1.05, 0, Math.PI * 2);
      ctx.fill();
      // Ice shards on the rim — 4 evenly spaced little spikes.
      ctx.fillStyle = '#e6f5fb';
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI * 2 * i) / 4 + e.x * 0.02;
        const sx = e.x + Math.cos(a) * e.radius * 0.95;
        const sy = e.y + Math.sin(a) * e.radius * 0.95;
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
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

// Enemy projectiles — hostile orbs with a menacing red/purple glow
// and a short ghostly trail. Visually distinct from player projectiles
// so players can read incoming fire at a glance.
//
// `p.homing` (boss phase 3) gets an extra pulsing tracking ring so
// players can tell "this one curves" without watching it for a beat.
export function drawEnemyProjectiles(ctx, projectiles, particles, cx, cy, W, H, time) {
  for (const p of projectiles) {
    if (p.x < cx - 30 || p.x > cx + W + 30 || p.y < cy - 30 || p.y > cy + H + 30) continue;
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    // Ghostly trail
    if (speed > 0) {
      const nx = -p.vx / speed, ny = -p.vy / speed;
      for (let t = 1; t <= 3; t++) {
        ctx.globalAlpha = 0.25 - t * 0.07;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x + nx * t * 5, p.y + ny * t * 5, p.radius * (1 - t * 0.2), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Homing tracking ring — pulses between r*1.4 and r*2.2 with a
    // sin tied to time + position so adjacent homers don't pulse
    // in sync. Outside the main body so it reads as targeting halo.
    if (p.homing) {
      const pulse = 1.4 + (Math.sin((time || 0) * 8 + p.x * 0.05) * 0.5 + 0.5) * 0.8;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Main body — outer glow + bright core
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    // White-hot core
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Spark particles
    if (particles && Math.random() < 0.3) {
      particles.push({
        x: p.x + (Math.random() - 0.5) * 4,
        y: p.y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 30,
        vy: (Math.random() - 0.5) * 30,
        life: 0.2, maxLife: 0.2,
        radius: 1 + Math.random(),
        color: p.color,
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
    // Two-phase: first 60% of life is the full jagged bolt; last 40%
    // is residual crackle at each struck endpoint only. Reads as
    // "impact → lingering spark" instead of a single jump-cut fade.
    const maxLife = ce.maxLife || 0.2;
    const lifeFrac = Math.max(0, ce.life / maxLife);
    if (lifeFrac > 0.4) {
      // Bolt phase — same jagged render as before but alpha mapped to
      // the active window (0.4..1.0 fraction) so the bolt fades out
      // before the residual takes over.
      const t = (lifeFrac - 0.4) / 0.6;
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
    } else {
      // Residual phase — small random-direction spark arcs at each
      // struck endpoint. Skip index 0 (the player/source). Alpha rises
      // into the phase then fades linearly.
      const rf = lifeFrac / 0.4; // 1→0
      ctx.shadowColor = ce.color;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = rf * 0.8;
      for (let i = 1; i < ce.points.length; i++) {
        const p = ce.points[i];
        // 2 short arcs in random directions per endpoint
        for (let j = 0; j < 2; j++) {
          const a = Math.random() * Math.PI * 2;
          const len = 4 + Math.random() * 6;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len);
          ctx.stroke();
        }
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// Meteor warn + explode effects — falling streak above the warn ring,
// dashed warn circle + pulsing center, expanding ring on explode.
// Reused by meteor + meteor_orbit + fortress shockwave + void_anchor +
// enemy death rings (all push to g.meteorEffects with the same shape).
export function drawMeteorEffects(ctx, meteorEffects) {
  for (const m of meteorEffects) {
    if (m.phase === 'warn') {
      // Falling streak from off-screen down to the warn ring — sells
      // the "something's coming" beat before the explosion.
      const warnDur = m.warnLife || 0.5; const t = Math.max(0, 1 - (m.life / warnDur));
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

      // Charge cooldown indicator — red arc that fills as cooldown
      // completes, so players know when the next dash is ready.
      // Bright flash when fully charged. barnaldo feedback: players
      // need visual clarity to play around the timing.
      if ((w.type === 'charge' || w.type === 'fortress') && !w.active) {
        const progress = Math.min(1, w.timer / w.cooldown);
        if (progress < 1) {
          const r = (p.radius || 14) + 6;
          ctx.strokeStyle = 'rgba(231, 76, 60, 0.4)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          ctx.stroke();
        } else {
          // Ready flash — subtle pulse when charge is available
          const pulse = 0.3 + Math.sin(time * 6) * 0.15;
          const r = (p.radius || 14) + 6;
          ctx.strokeStyle = `rgba(231, 76, 60, ${pulse})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
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

      if (w.type === 'inferno_wheel') {
        const phase = w.phase || 0;
        const orbitR = w.radius * sm;
        const bladeR = w.bladeRadius * sm;
        const count = w.bladeCount + pb;
        for (let b = 0; b < count; b++) {
          const angle = phase + (b * Math.PI * 2 / count);
          const bx = p.x + Math.cos(angle) * orbitR;
          const by = p.y + Math.sin(angle) * orbitR;
          // Trailing ember arc behind the blade — three decaying
          // after-images so the blade's path reads as swept fire.
          for (let t = 1; t <= 3; t++) {
            const ta = angle - t * 0.18;
            const tx = p.x + Math.cos(ta) * orbitR;
            const ty = p.y + Math.sin(ta) * orbitR;
            ctx.globalAlpha = 0.35 / t;
            ctx.fillStyle = t === 1 ? '#f39c12' : '#e74c3c';
            ctx.beginPath();
            ctx.arc(tx, ty, bladeR * (0.7 - t * 0.15), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          // Blade body — layered glow + hot core. No gradient object
          // per blade (fillStyle rgba is cheaper than createRadialGradient
          // and the profile flagged gradients as acceptable but still
          // worth avoiding in a multi-blade loop).
          ctx.fillStyle = 'rgba(231, 76, 60, 0.45)';
          ctx.beginPath();
          ctx.arc(bx, by, bladeR, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(243, 156, 18, 0.75)';
          ctx.beginPath();
          ctx.arc(bx, by, bladeR * 0.65, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 220, 150, 0.9)';
          ctx.beginPath();
          ctx.arc(bx, by, bladeR * 0.3 + Math.sin(time * 9 + b) * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (w.type === 'tesla_aegis') {
        const ph = w.phase || 0;
        const pp = w.pulsePhase || 0;
        const pc = w.pulseCount || 0;
        // Overcharge tells: next pulse (pc+1) is the 4th → show brighter
        // shell + rapid-flicker arcs. Mirrors thunder_god's tell pattern.
        const overchargeReady = (pc + 1) % 4 === 0;
        const r = w.shieldRadius * sm * (1 + Math.sin(ph) * 0.08);
        const grad = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r);
        if (overchargeReady) {
          grad.addColorStop(0,   'rgba(200, 230, 255, 0.05)');
          grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.2)');
          grad.addColorStop(1,   'rgba(178, 220, 255, 0.45)');
        } else {
          grad.addColorStop(0,   'rgba(116, 185, 255, 0)');
          grad.addColorStop(0.7, 'rgba(116, 185, 255, 0.15)');
          grad.addColorStop(1,   'rgba(178, 220, 255, 0.3)');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = overchargeReady ? 'rgba(255, 255, 255, 0.95)' : 'rgba(178, 220, 255, 0.85)';
        ctx.lineWidth = overchargeReady ? 3 : 2;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -ph * 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        // Pulse preview ring — expands outward as pulseTimer counts
        // down, giving players a tell for when the next zap fires.
        const pulseFrac = 1 - Math.min(1, Math.max(0, (w.pulseTimer || 0) / w.pulseCooldown));
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 * (1 - pulseFrac)})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (0.5 + pulseFrac * 0.55), 0, Math.PI * 2);
        ctx.stroke();
        // Ambient arcs — denser when overcharge is next so the shield
        // visibly crackles during the telegraph window.
        const arcChance = overchargeReady ? 0.9 : 0.5;
        if (Math.random() < arcChance) {
          const a1 = Math.random() * Math.PI * 2;
          const a2 = a1 + (Math.random() - 0.5) * 0.7;
          const r1 = r * (0.3 + Math.random() * 0.6);
          const r2 = r * (0.3 + Math.random() * 0.6);
          ctx.strokeStyle = 'rgba(220, 240, 255, 0.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(a1) * r1, p.y + Math.sin(a1) * r1);
          ctx.lineTo(p.x + Math.cos(a2) * r2, p.y + Math.sin(a2) * r2);
          ctx.stroke();
        }
        ctx.fillStyle = '#eaf6ff';
        for (let i = 0; i < 4; i++) {
          const a = pp * 0.25 + (Math.PI * 2 / 4) * i;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

// Gem render: sprite when loaded, blue diamond fallback. Tier
// scales the visual so high-XP drops (boss/elite) read distinct
// from common swarm gems on the ground.
//
// Tier sources:
//  - SP: derived from gem.xp (sim has the raw value)
//  - MP: server ships gem.tier directly (snapshot omits xp)
const GEM_TIER_SCALE = [1, 1.5, 2.2];
const GEM_TIER_COLOR = ['#3498db', '#9b59b6', '#f1c40f'];
function gemTier(gem) {
  if (gem.tier !== undefined) return gem.tier;
  if (gem.xp >= 80) return 2;
  if (gem.xp >= 30) return 1;
  return 0;
}
export function drawGem(ctx, gem, drawSprite, fallbackRadius = 6) {
  const tier = gemTier(gem);
  const scale = GEM_TIER_SCALE[tier];
  if (drawSprite('gem', gem.x, gem.y, 0.9 * scale, 0.85)) return;
  const r = (gem.radius || fallbackRadius) * scale;
  ctx.fillStyle = GEM_TIER_COLOR[tier];
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

// Consumable pickups — bomb/shield/magnet ground items. Drawn as
// glowing circles with an icon, bob + late-life fade. Viewport-culled.
const CONSUMABLE_ICONS = { bomb: '💣', shield: '🛡', magnet: '🧲' };
export function drawConsumables(ctx, consumables, drawSprite, cx, cy, W, H) {
  for (const c of consumables) {
    if (c.x < cx - 20 || c.x > cx + W + 20 || c.y < cy - 20 || c.y > cy + H + 20) continue;
    const bob = Math.sin(c.bobPhase) * 3;
    const fadeAlpha = c.life < 3 ? c.life / 3 : 1;
    const pulseScale = 1 + Math.sin(c.bobPhase * 2) * 0.1;
    ctx.save();
    ctx.globalAlpha = fadeAlpha;
    // Outer glow
    ctx.fillStyle = c.color;
    ctx.globalAlpha = fadeAlpha * 0.25;
    ctx.beginPath();
    ctx.arc(c.x, c.y + bob, c.radius * 2.2 * pulseScale, 0, Math.PI * 2);
    ctx.fill();
    // Inner circle
    ctx.globalAlpha = fadeAlpha * 0.85;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(c.x, c.y + bob, c.radius * pulseScale, 0, Math.PI * 2);
    ctx.fill();
    // White border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = fadeAlpha * 0.6;
    ctx.stroke();
    // Icon fallback (emoji text)
    ctx.globalAlpha = fadeAlpha;
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(c.radius * 1.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(CONSUMABLE_ICONS[c.type] || '?', c.x, c.y + bob);
    ctx.restore();
  }
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
  // Optional per-subphase marker for the SP perf harness. No-op in
  // prod / MP. Caller supplies `onPhase(label)` which closes the
  // previous bucket each time it's invoked.
  const mark = opts.onPhase || null;
  for (const gem of view.gems) {
    if (gem.x < cx - 20 || gem.x > cx + W + 20 || gem.y < cy - 20 || gem.y > cy + H + 20) continue;
    drawGem(ctx, gem, drawSprite);
  }
  drawHeartDrops(ctx, view.heartDrops || [], drawSprite, cx, cy, W, H);
  drawConsumables(ctx, view.consumables || [], drawSprite, cx, cy, W, H);
  if (mark) mark('gems');
  drawChargeTrailWake(ctx, view.chargeTrails || [], particles, view.time || 0, viewport);
  drawWeaponAuras(ctx, view.players, view.time || 0, viewport);
  if (mark) mark('auras');
  drawEnemies(ctx, view.enemies, drawSprite, cx, cy, W, H, opts.onSeen);
  if (mark) mark('enemies');
  drawProjectiles(ctx, view.projectiles, drawSprite, particles, cx, cy, W, H);
  drawEnemyProjectiles(ctx, view.enemyProjectiles || [], particles, cx, cy, W, H, view.time || 0);
  if (mark) mark('projectiles');
}

// Charge fire-wake render — lingering damage zones left behind a
// charge dash. Was a flat alpha-fading circle; now flickers like
// fire and occasionally drops upward-drifting embers so it reads
// as a real burning patch instead of a transparent disc.
function drawChargeTrailWake(ctx, trails, particles, time, viewport) {
  const { cx, cy, W, H } = viewport;
  for (const t of trails) {
    if (t.x < cx - t.radius || t.x > cx + W + t.radius ||
        t.y < cy - t.radius || t.y > cy + H + t.radius) continue;
    // Per-trail offset so two adjacent trails don't flicker in sync.
    const flicker = 0.85 + Math.sin(time * 9 + t.x * 0.05) * 0.15;
    const baseAlpha = Math.min(1, t.life * 1.5) * 0.4;
    ctx.save();
    ctx.globalAlpha = baseAlpha * flicker;
    ctx.fillStyle = t.color || '#e74c3c';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
    ctx.fill();
    // Bright flickering core — shifted half a step out of phase
    // so the inner heat doesn't pulse with the outer body.
    ctx.globalAlpha = baseAlpha * 0.6 * flicker;
    ctx.fillStyle = '#f39c12';
    const coreScale = 0.45 + Math.sin(time * 11 + t.x * 0.07) * 0.08;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius * coreScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Occasional upward ember — keyed off life so old trails stop
    // emitting before they fully fade.
    if (particles && t.life > 0.15 && Math.random() < 0.18) {
      const ang = Math.random() * Math.PI * 2;
      const offR = Math.random() * t.radius * 0.7;
      particles.push({
        x: t.x + Math.cos(ang) * offR,
        y: t.y + Math.sin(ang) * offR,
        vx: (Math.random() - 0.5) * 30,
        vy: -40 - Math.random() * 50,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7,
        radius: 1.2 + Math.random() * 1.6,
        color: Math.random() < 0.5 ? '#f39c12' : '#e74c3c',
      });
    }
  }
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

// Fire-trail cosmetic spawner — pushes ember particles behind a
// player while they're moving, throttled so trails don't clot. Runs
// during the client update step (not render) since it advances a
// timer that depends on dt.
//
// Per-player throttle state lives in `trailState` — a Map keyed by
// player id that the caller owns. SP keeps one map with one entry;
// MP keeps one map with N entries. Position delta is the movement
// check — avoids spawning particles on a stationary peer whose
// p.facing is stale from the last move.
export function spawnFireTrail(p, dt, particles, trailState) {
  let st = trailState.get(p.id);
  if (!st) { st = { timer: 0, lastX: p.x, lastY: p.y }; trailState.set(p.id, st); }
  const dx = p.x - st.lastX, dy = p.y - st.lastY;
  const moved = dx * dx + dy * dy > 0.5;
  st.lastX = p.x; st.lastY = p.y;
  st.timer -= dt;
  if (st.timer > 0 || !moved) return;
  st.timer = 0.03; // ~33 particles/sec while moving
  particles.push({
    x: p.x + (Math.random() - 0.5) * 4,
    y: p.y + (Math.random() - 0.5) * 4,
    vx: (Math.random() - 0.5) * 30,
    vy: -40 - Math.random() * 60,
    life: 0.3 + Math.random() * 0.3,
    maxLife: 0.6,
    radius: 2 + Math.random() * 2,
    color: Math.random() > 0.4 ? '#f39c12' : '#e74c3c',
  });
}

export function drawPendingPulls(ctx, pendingPulls) {
  if (!pendingPulls || pendingPulls.length === 0) return;
  for (const pull of pendingPulls) {
    const progress = pull.elapsed / pull.duration;
    const alpha = 0.5 * (1 - progress);
    const ringR = pull.radius * (1 - progress * 0.3);
    ctx.strokeStyle = `rgba(108, 92, 231, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.shadowColor = '#6c5ce7';
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(pull.x, pull.y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(162, 155, 254, ${alpha * 0.6})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pull.x, pull.y, ringR * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
  }
}
