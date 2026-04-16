// Runtime background rendering — 3-tier fallback:
//   1. Pre-baked tileset canvas (nearest-neighbor blit, nearly free)
//   2. Neon abstract render for code-only maps (abstractRender === 'neon')
//   3. Dark grid fallback when neither is available
//
// Called once per frame from both SP and MP render loops.

import { MAPS } from './maps.js';
import { drawNeonBackground } from './obstacleSprites.js';

/**
 * Draw the map background into ctx.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement|null}   bgCanvas  Pre-baked tileset canvas, or null
 * @param {string}                   mapId
 * @param {{ w: number, h: number }} arena     Map world dimensions
 * @param {number}                   cx        Camera left edge (world coords)
 * @param {number}                   cy        Camera top edge (world coords)
 * @param {number}                   W         Viewport width
 * @param {number}                   H         Viewport height
 */
export function drawBackground(ctx, bgCanvas, mapId, arena, cx, cy, W, H) {
  if (bgCanvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bgCanvas, 0, 0, bgCanvas.width, bgCanvas.height, 0, 0, arena.w, arena.h);
    ctx.imageSmoothingEnabled = true;
  } else if (MAPS[mapId]?.abstractRender === 'neon') {
    drawNeonBackground(ctx, cx, cy, W, H, arena);
  } else {
    const gridSize = 60;
    const startX = Math.floor(cx / gridSize) * gridSize;
    const startY = Math.floor(cy / gridSize) * gridSize;
    ctx.strokeStyle = '#12121a';
    ctx.lineWidth = 1;
    for (let x = startX; x < cx + W + gridSize; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, cy + H); ctx.stroke();
    }
    for (let y = startY; y < cy + H + gridSize; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx + W, y); ctx.stroke();
    }
  }
}
