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

// Mulberry32 — same shape as sim/rng.js but inlined here so this module
// stays standalone and doesn't drag the sim into the renderer.
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-map "patch" generator: drops a handful of lower-terrain blobs
// across the corner grid, deterministic from mapId so SP/MP/replays all
// see the same layout. Returns a function (cx, cy) -> true if the corner
// is *upper* (the base terrain). False = lower (path/dirt/scorch patch).
//
// Density tuning: ~6% of corners end up lower. That's enough to break
// up the uniform texture without making the map look diseased.
function terrainPatchFn(mapId, tilesX, tilesY) {
  const rng = mulberry32(hash32(mapId));
  const blobCount = Math.max(6, Math.round(tilesX * tilesY * 0.012));
  const blobs = [];
  for (let i = 0; i < blobCount; i++) {
    blobs.push({
      x: rng() * tilesX,
      y: rng() * tilesY,
      r: 2 + rng() * 3,
    });
  }
  return (cx, cy) => {
    for (const b of blobs) {
      const dx = cx - b.x, dy = cy - b.y;
      if (dx * dx + dy * dy < b.r * b.r) return false; // lower
    }
    return true; // upper
  };
}

// Composite the whole map into a small offscreen canvas at native tile
// resolution (one 16×16 tile per cell). Cached per mapId — same map id
// returns the same canvas. The render path scales this up to world size
// with imageSmoothingEnabled=false for crisp pixel-art look.
export async function buildBackgroundCanvas(mapId) {
  if (BG_CACHE.has(mapId)) return BG_CACHE.get(mapId);
  const map = MAPS[mapId];
  if (!map?.tileset) return null;
  const ts = await loadTileset(map.tileset);
  if (!ts) return null;

  const tileWorld = 64;                           // one Wang tile = 64u in the world
  const tilesX = Math.ceil(map.width / tileWorld);
  const tilesY = Math.ceil(map.height / tileWorld);
  const off = document.createElement('canvas');
  off.width = tilesX * ts.tileSize;
  off.height = tilesY * ts.tileSize;
  const ctx = off.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const isUpper = terrainPatchFn(mapId, tilesX, tilesY);
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
