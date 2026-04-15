// Procedural obstacle generators. Pure functions — take an rng and a
// config, return an array of obstacles. Used by maps with a
// `generateObstacles` field instead of a static `obstacles` array.
//
// Determinism contract: same rng seed + same config → same output. Tests
// rely on this since MP clients need to agree on layout without the
// server streaming every rect (welcome message ships the generated list
// once, but regen-on-retry in SP has to match what the player saw).

/**
 * Cluster-scatter generator. Places `clusterCount` cluster centers then
 * drops `objectsPerCluster` (random in range) obstacles around each
 * within `clusterRadius`. Skips anything inside the spawn safe zone so
 * players can't start inside a tree.
 *
 * Config:
 *   width, height        — arena bounds
 *   clusterCount         — how many clusters to drop
 *   objectsPerCluster    — [min, max] per cluster (uniform)
 *   clusterRadius        — scatter radius around each center
 *   objectSize           — square obstacle w/h
 *   type                 — obstacle type (e.g. 'tree', 'pillar', 'tomb')
 *   spawnSafeZone        — { x, y, radius } — no obstacles inside
 *   edgeMargin           — keep this far from world edges (default 120)
 *   minSeparation        — don't overlap another obstacle closer than this (default objectSize)
 */
export function generateClusterScatter(rng, cfg) {
  const {
    width, height,
    clusterCount,
    objectsPerCluster: [minPer, maxPer],
    clusterRadius,
    objectSize,
    type,
    spawnSafeZone,
    edgeMargin = 120,
    minSeparation = objectSize,
  } = cfg;

  const out = [];
  const minSep2 = minSeparation * minSeparation;
  const szZone2 = spawnSafeZone
    ? (spawnSafeZone.radius + objectSize) * (spawnSafeZone.radius + objectSize)
    : 0;

  for (let c = 0; c < clusterCount; c++) {
    // Cluster center — anywhere in the arena but not in the spawn zone.
    // Give up after 20 tries to avoid worst-case thrashing; the spawn
    // zone is small vs the arena, so 20 tries is more than enough.
    let cx = 0, cy = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      cx = edgeMargin + rng.random() * (width  - edgeMargin * 2);
      cy = edgeMargin + rng.random() * (height - edgeMargin * 2);
      if (!spawnSafeZone) break;
      const dx = cx - spawnSafeZone.x, dy = cy - spawnSafeZone.y;
      if (dx * dx + dy * dy > szZone2) break;
    }
    const count = minPer + Math.floor(rng.random() * (maxPer - minPer + 1));
    for (let i = 0; i < count; i++) {
      // Polar scatter inside clusterRadius — not uniform by area, which
      // gives a tighter core and looser edges. Matches natural forest
      // clumping more than a uniform disc.
      const ang = rng.random() * Math.PI * 2;
      const dist = rng.random() * clusterRadius;
      const ox = Math.max(edgeMargin, Math.min(width  - edgeMargin - objectSize, cx + Math.cos(ang) * dist));
      const oy = Math.max(edgeMargin, Math.min(height - edgeMargin - objectSize, cy + Math.sin(ang) * dist));
      // Re-check spawn zone after clamping (edge clamps can pull
      // obstacles back toward the center).
      if (spawnSafeZone) {
        const dx = ox - spawnSafeZone.x, dy = oy - spawnSafeZone.y;
        if (dx * dx + dy * dy < szZone2) continue;
      }
      // Overlap check vs already-placed obstacles. O(n²) but generated
      // counts are small (< 100 per map).
      let overlap = false;
      for (const o of out) {
        const ddx = ox - o.x, ddy = oy - o.y;
        if (ddx * ddx + ddy * ddy < minSep2) { overlap = true; break; }
      }
      if (overlap) continue;
      out.push({ x: ox, y: oy, w: objectSize, h: objectSize, type });
    }
  }
  return out;
}

/**
 * Corridor generator — places two parallel walls with a meandering gap,
 * then scatters decorative pillars between them. Gives a "ruined hallway"
 * feel. Variant for procedural ruins maps.
 *
 * Config:
 *   width, height, type (for walls), pillarType, objectSize
 */
export function generateCorridor(rng, cfg) {
  const { width, height, type = 'wall', pillarType = 'pillar', objectSize = 60 } = cfg;
  const out = [];
  // Wall segments — 6-8 slabs along each side, with gaps between them.
  const sideY1 = height * 0.35;
  const sideY2 = height * 0.65;
  const slabs = 5 + Math.floor(rng.random() * 3);
  for (let i = 0; i < slabs; i++) {
    const segW = 180 + rng.random() * 120;
    const gap = 40 + rng.random() * 80;
    const x = 200 + (i * (width - 400) / slabs) + rng.random() * gap;
    out.push({ x, y: sideY1, w: segW, h: 40, type });
    out.push({ x: x + rng.random() * 120, y: sideY2, w: segW, h: 40, type });
  }
  // Interior pillars
  const pillarCount = 8 + Math.floor(rng.random() * 5);
  for (let i = 0; i < pillarCount; i++) {
    const x = 300 + rng.random() * (width - 600);
    const y = sideY1 + 80 + rng.random() * (sideY2 - sideY1 - 160);
    out.push({ x, y, w: objectSize, h: objectSize, type: pillarType });
  }
  return out;
}
