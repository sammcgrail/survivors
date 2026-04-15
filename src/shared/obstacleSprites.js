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
