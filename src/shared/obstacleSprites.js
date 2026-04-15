// Pixellab-generated obstacle sprites. One PNG per obstacle type lives
// in assets/objects/. Falls back to a colored AABB if the sprite never
// loaded — keeps the renderer from going blank on a 404 or fetch error.
//
// Walls are AABBs that can be much wider than the 32×32 sprite, so they
// tile rather than stretch. Round/blocky obstacles (trees, pillars,
// tombs) get a single sprite stretched to fill — pixel art tolerates
// modest scale-up well, and one big sprite reads better than four
// quartered minis.

const SPRITES = {};
const TYPES = ['tree', 'pillar', 'wall', 'tomb'];

export function loadObstacleSprites() {
  return Promise.all(TYPES.map(type => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { SPRITES[type] = img; resolve(); };
    img.onerror = () => resolve(); // missing sprite — fallback color path
    img.src = `assets/objects/${type}.png`;
  })));
}

export function drawObstacle(ctx, obs) {
  // Abstract neon types — pure-code geometry, no asset. Pulses on a
  // shared time read so all neon obstacles animate together.
  if (obs.type === 'neon_pillar' || obs.type === 'neon_wall') {
    drawNeonObstacle(ctx, obs);
    return;
  }
  const sprite = SPRITES[obs.type];
  if (!sprite) {
    // Same fallback palette the old colored-rect renderer used.
    if (obs.type === 'wall' || obs.type === 'tomb') ctx.fillStyle = '#1a1a2e';
    else if (obs.type === 'pillar')                  ctx.fillStyle = '#2a1a1e';
    else if (obs.type === 'tree')                    ctx.fillStyle = 'rgba(46, 100, 60, 0.5)';
    else                                              ctx.fillStyle = '#444';
    ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
    return;
  }
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  if (obs.type === 'wall') {
    for (let ox = 0; ox < obs.w; ox += 32) {
      for (let oy = 0; oy < obs.h; oy += 32) {
        const dw = Math.min(32, obs.w - ox);
        const dh = Math.min(32, obs.h - oy);
        ctx.drawImage(sprite, 0, 0, dw, dh, obs.x + ox, obs.y + oy, dw, dh);
      }
    }
  } else {
    ctx.drawImage(sprite, obs.x, obs.y, obs.w, obs.h);
  }
  ctx.imageSmoothingEnabled = prev;
}

// Neon-themed background: dark navy gradient + faint glowing grid.
// Painted into the world transform, so cx/cy/W/H are screen-rect bounds
// in world coordinates (after the camera translate).
export function drawNeonBackground(ctx, cx, cy, W, H, arena) {
  // Solid backdrop covering the visible screen area in world space.
  ctx.fillStyle = '#05050f';
  ctx.fillRect(cx, cy, W, H);
  // Sparse glowing grid — every 200u — confined to the arena bounds.
  const grid = 200;
  const x0 = Math.max(0, Math.floor(cx / grid) * grid);
  const x1 = Math.min(arena.w, cx + W + grid);
  const y0 = Math.max(0, Math.floor(cy / grid) * grid);
  const y1 = Math.min(arena.h, cy + H + grid);
  ctx.strokeStyle = 'rgba(0, 200, 255, 0.18)';
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, Math.max(0, cy));
    ctx.lineTo(x, Math.min(arena.h, cy + H));
    ctx.stroke();
  }
  for (let y = y0; y <= y1; y += grid) {
    ctx.beginPath();
    ctx.moveTo(Math.max(0, cx), y);
    ctx.lineTo(Math.min(arena.w, cx + W), y);
    ctx.stroke();
  }
}

function drawNeonObstacle(ctx, obs) {
  const t = performance.now() / 1000;
  const pulse = 0.65 + Math.sin(t * 2.5) * 0.25;
  const cx = obs.x + obs.w / 2;
  const cy = obs.y + obs.h / 2;
  if (obs.type === 'neon_pillar') {
    const r = Math.min(obs.w, obs.h) / 2;
    ctx.save();
    ctx.shadowColor = '#00ffea';
    ctx.shadowBlur = 18 * pulse;
    ctx.fillStyle = `rgba(0, 255, 234, ${0.85 * pulse})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.shadowColor = '#ff00d4';
  ctx.shadowBlur = 14 * pulse;
  ctx.fillStyle = `rgba(255, 0, 212, ${0.7 * pulse})`;
  ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  if (obs.w > obs.h) {
    ctx.fillRect(obs.x, obs.y + obs.h * 0.4, obs.w, obs.h * 0.2);
  } else {
    ctx.fillRect(obs.x + obs.w * 0.4, obs.y, obs.w * 0.2, obs.h);
  }
  ctx.restore();
}
