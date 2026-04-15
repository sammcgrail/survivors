// Wang corner-sampling tileset renderer.
//
// Each tileset PNG is a 4×4 grid of 16×16 tiles covering all 16 corner
// combinations between two terrain types ("lower" + "upper"). The
// accompanying JSON ships a corner→bbox table so we can pick the right
// tile per cell from a 1/0 corner grid.
//
// Pipeline: loadTileset() reads PNG + JSON. buildBackgroundCanvas()
// composites the whole map into a small offscreen canvas (one 16-px tile
// per cell, native pixel scale) using a per-map terrain-patch generator.
// At render time the main loop blits that canvas as one drawImage with
// imageSmoothingEnabled=false — sharp pixel-art upscale, almost free.

import { MAPS } from './maps.js';
import { isLowerCorner, TILE_WORLD_SIZE } from './mapTerrain.js';

const TILESETS = new Map();      // name -> { img, lookup: Map<key, bbox>, tileSize }
const BG_CACHE = new Map();      // mapId -> HTMLCanvasElement

// Pixellab Wang index encoding from the tileset JSON: each tile lists
// its NW/NE/SE/SW corners as "upper" or "lower". We encode any 4-corner
// state to the same 4-bit key so the lookup is O(1).
function cornerKey(nw, ne, se, sw) {
  return (nw ? 8 : 0) | (ne ? 4 : 0) | (se ? 2 : 0) | (sw ? 1 : 0);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src + ' 404'));
    img.src = src;
  });
}

export async function loadTileset(name) {
  if (!name) return null;
  if (TILESETS.has(name)) return TILESETS.get(name);
  const [img, meta] = await Promise.all([
    loadImage(`assets/tiles/${name}.png`),
    fetch(`assets/tiles/${name}.json`).then(r => r.json()),
  ]);
  const lookup = new Map();
  const tileSize = meta.tile_size?.width || 16;
  for (const t of meta.tileset_data.tiles) {
    const k = cornerKey(
      t.corners.NW === 'upper',
      t.corners.NE === 'upper',
      t.corners.SE === 'upper',
      t.corners.SW === 'upper',
    );
    lookup.set(k, t.bounding_box);
  }
  const ts = { img, lookup, tileSize };
  TILESETS.set(name, ts);
  return ts;
}

// Composite the whole map into a small offscreen canvas at native tile
// resolution (one 16×16 tile per cell). Cached per mapId — same map id
// returns the same canvas. Patch placement comes from shared mapTerrain
// so the gameplay sim and the renderer see identical patches.
export async function buildBackgroundCanvas(mapId) {
  if (BG_CACHE.has(mapId)) return BG_CACHE.get(mapId);
  const map = MAPS[mapId];
  if (!map?.tileset) return null;
  const ts = await loadTileset(map.tileset);
  if (!ts) return null;

  const tilesX = Math.ceil(map.width / TILE_WORLD_SIZE);
  const tilesY = Math.ceil(map.height / TILE_WORLD_SIZE);
  const off = document.createElement('canvas');
  off.width = tilesX * ts.tileSize;
  off.height = tilesY * ts.tileSize;
  const ctx = off.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // True corner = upper (base) terrain; false = lower (patch).
  const isUpper = (cx, cy) => !isLowerCorner(mapId, cx, cy);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const k = cornerKey(
        isUpper(tx, ty),
        isUpper(tx + 1, ty),
        isUpper(tx + 1, ty + 1),
        isUpper(tx, ty + 1),
      );
      // Fallback to all-upper (key 15) if the tileset is missing a
      // corner combo — leaves the cell as base terrain instead of
      // empty/black.
      const bb = ts.lookup.get(k) || ts.lookup.get(15);
      if (!bb) continue;
      ctx.drawImage(
        ts.img, bb.x, bb.y, bb.width, bb.height,
        tx * ts.tileSize, ty * ts.tileSize,
        ts.tileSize, ts.tileSize,
      );
    }
  }
  BG_CACHE.set(mapId, off);
  return off;
}
