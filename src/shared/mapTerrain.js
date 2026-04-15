// Per-map terrain patches — deterministic from mapId so SP, MP, and
// the visual renderer all agree on where lower-terrain blobs (mud /
// gravel / scorched ground / lava) sit on the map.
//
// The visual `tileBackground.js` builds a corner grid from `isLowerCorner`;
// the sim tick uses `isOnPatch(world x,y)` to decide whether to apply the
// per-map terrain effect (slow movement or damage-over-time) to a player.

import { MAPS } from './maps.js';

const TILE_WORLD = 64;             // one Wang cell = 64u in the world
const CACHE = new Map();           // mapId -> { tilesX, tilesY, blobs }

function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
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

function buildPatches(mapId) {
  const map = MAPS[mapId];
  if (!map) return null;
  const tilesX = Math.ceil(map.width / TILE_WORLD);
  const tilesY = Math.ceil(map.height / TILE_WORLD);
  const rng = mulberry32(hash32(mapId));
  const blobCount = Math.max(6, Math.round(tilesX * tilesY * 0.012));
  const blobs = [];
  for (let i = 0; i < blobCount; i++) {
    const cx = rng() * tilesX;
    const cy = rng() * tilesY;
    const r = 2 + rng() * 3;
    // Store both corner-grid coords (for the renderer) and world-space
    // (for the gameplay point-in-blob check) — saves repeating the
    // multiply on every call.
    blobs.push({ cx, cy, cr: r, x: cx * TILE_WORLD, y: cy * TILE_WORLD, r: r * TILE_WORLD });
  }
  return { tilesX, tilesY, blobs };
}

function getPatches(mapId) {
  if (!CACHE.has(mapId)) CACHE.set(mapId, buildPatches(mapId));
  return CACHE.get(mapId);
}

export function isLowerCorner(mapId, cx, cy) {
  const p = getPatches(mapId);
  if (!p) return false;
  for (const b of p.blobs) {
    const dx = cx - b.cx, dy = cy - b.cy;
    if (dx * dx + dy * dy < b.cr * b.cr) return true;
  }
  return false;
}

export function isOnPatch(mapId, x, y) {
  const p = getPatches(mapId);
  if (!p) return false;
  for (const b of p.blobs) {
    const dx = x - b.x, dy = y - b.y;
    if (dx * dx + dy * dy < b.r * b.r) return true;
  }
  return false;
}

export const TILE_WORLD_SIZE = TILE_WORLD;
