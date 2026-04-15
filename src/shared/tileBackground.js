// Tiled-background loader for map themes. Each map lists a `tileset`
// name; this module loads the matching PNG from /assets/tiles/ and
// returns a CanvasPattern tiled at the upper-corner (single-terrain)
// tile from the Wang set. No corner sampling — just one ground texture
// repeated across the arena. Transition tiles are available for future
// use when we want patches of different terrain.

const PATTERN_CACHE = new Map(); // tileset name -> CanvasPattern

// Load + slice the all-upper-corners tile (the pure terrain variant)
// from a Wang tileset PNG. Resolves to a CanvasPattern usable as
// ctx.fillStyle, or null if the asset isn't reachable.
export async function loadTilePattern(ctx, tileset) {
  if (!tileset) return null;
  if (PATTERN_CACHE.has(tileset)) return PATTERN_CACHE.get(tileset);

  const img = new Image();
  img.src = `assets/tiles/${tileset}.png`;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`tileset ${tileset} 404`));
  });

  // Pixellab Wang tilesets are 4x4 grids of 16x16 tiles. The all-upper
  // tile (NW=u NE=u SW=u SE=u) sits at column 0, row 3 → pixel (0, 48).
  const tile = document.createElement('canvas');
  tile.width = 16; tile.height = 16;
  tile.getContext('2d').drawImage(img, 0, 48, 16, 16, 0, 0, 16, 16);

  const pattern = ctx.createPattern(tile, 'repeat');
  PATTERN_CACHE.set(tileset, pattern);
  return pattern;
}
