// Map definitions — each map describes the arena bounds, the obstacle
// list, and (eventually) which tileset to render under it. Both SP and
// MP read from this catalog; server picks one at game start and sends
// the obstacles to clients in the welcome message.
//
// Obstacles are axis-aligned rectangles for cheap collision. `type`
// determines look + behaviour:
//   wall   — blocks movement + projectiles (opaque stone)
//   pillar — blocks movement + projectiles (smaller, scattered)
//   tree   — blocks movement only (projectiles pass through)
//   tomb   — blocks movement + projectiles (graveyard theme)
//   lava   — does NOT block movement (would feel bad) but damages on
//            contact; tick checks separately. Currently unused — wired
//            up when volcano map needs the gameplay hook.

export const MAPS = {
  arena: {
    name: 'The Arena',
    width: 3000, height: 3000,
    tileset: null,           // open field, plain grid render
    obstacles: [],
    spawns: [{ x: 1500, y: 1500, radius: 200 }],
    terrainEffect: null,     // no patches, no effects
  },

  forest: {
    name: 'Dark Forest',
    width: 3500, height: 3500,
    tileset: 'forest',
    terrainEffect: { type: 'slow', factor: 0.55 }, // sticky mud patches

    obstacles: [
      // Scattered tree clusters — tree obstacles don't block projectiles.
      { x:  500, y:  500, w: 60, h: 60, type: 'tree' },
      { x:  580, y:  480, w: 60, h: 60, type: 'tree' },
      { x:  650, y:  600, w: 60, h: 60, type: 'tree' },
      { x: 1200, y:  300, w: 60, h: 60, type: 'tree' },
      { x: 1280, y:  370, w: 60, h: 60, type: 'tree' },
      { x: 2200, y:  800, w: 60, h: 60, type: 'tree' },
      { x: 2280, y:  870, w: 60, h: 60, type: 'tree' },
      { x: 2350, y:  800, w: 60, h: 60, type: 'tree' },
      { x:  300, y: 2200, w: 60, h: 60, type: 'tree' },
      { x:  380, y: 2280, w: 60, h: 60, type: 'tree' },
      { x: 1700, y: 2400, w: 60, h: 60, type: 'tree' },
      { x: 1780, y: 2480, w: 60, h: 60, type: 'tree' },
      { x: 1850, y: 2400, w: 60, h: 60, type: 'tree' },
      { x: 2900, y: 1500, w: 60, h: 60, type: 'tree' },
      { x: 2980, y: 1580, w: 60, h: 60, type: 'tree' },
      { x: 3050, y: 1500, w: 60, h: 60, type: 'tree' },
      { x:  600, y: 3000, w: 60, h: 60, type: 'tree' },
      { x:  700, y: 3050, w: 60, h: 60, type: 'tree' },
      { x: 2400, y: 3100, w: 60, h: 60, type: 'tree' },
      { x: 3200, y:  600, w: 60, h: 60, type: 'tree' },
    ],
    spawns: [{ x: 1750, y: 1750, radius: 250 }],
  },

  ruins: {
    name: 'Ancient Ruins',
    width: 3000, height: 3000,
    tileset: 'ruins',
    terrainEffect: { type: 'slow', factor: 0.55 }, // gravel patches — loose footing

    obstacles: [
      // Inner courtyard with broken walls + columns
      { x:  800, y:  800, w: 200, h: 40, type: 'wall' },
      { x:  800, y:  800, w:  40, h: 200, type: 'wall' },
      { x: 2000, y:  800, w: 200, h: 40, type: 'wall' },
      { x: 2160, y:  800, w:  40, h: 200, type: 'wall' },
      { x:  800, y: 2160, w: 200, h: 40, type: 'wall' },
      { x:  800, y: 2000, w:  40, h: 200, type: 'wall' },
      { x: 2000, y: 2160, w: 200, h: 40, type: 'wall' },
      { x: 2160, y: 2000, w:  40, h: 200, type: 'wall' },
      // Column ring around centre
      { x: 1200, y: 1200, w: 60, h: 60, type: 'pillar' },
      { x: 1740, y: 1200, w: 60, h: 60, type: 'pillar' },
      { x: 1200, y: 1740, w: 60, h: 60, type: 'pillar' },
      { x: 1740, y: 1740, w: 60, h: 60, type: 'pillar' },
    ],
    spawns: [{ x: 1500, y: 1500, radius: 150 }],
  },

  // "Neon Grid" — code-rendered abstract map. No pixellab assets; the
  // obstacles are geometric primitives that the renderer paints with a
  // glowing-line aesthetic. Layout is a hand-tuned ring pattern: 12
  // pillars outside, 12 pillars inside (offset half-angle), and 4 wall
  // segments forming a central square with cardinal openings.
  neon: {
    name: 'Neon Grid',
    width: 3000, height: 3000,
    tileset: null,
    terrainEffect: null,
    abstractRender: 'neon',  // signals the renderer to use neon bg + glowing obstacles
    obstacles: (() => {
      const o = [];
      const cx = 1500, cy = 1500;
      const ring = (count, radius, angleOffset, type, size) => {
        for (let i = 0; i < count; i++) {
          const a = angleOffset + (i * Math.PI * 2) / count;
          o.push({
            x: cx + Math.cos(a) * radius - size / 2,
            y: cy + Math.sin(a) * radius - size / 2,
            w: size, h: size, type,
          });
        }
      };
      ring(12, 1100, 0, 'neon_pillar', 70);
      ring(8, 600, Math.PI / 8, 'neon_pillar', 60);
      // Inner square arena (200u square, 4 walls each 280 long, with 80u
      // gap on each side at the cardinal midpoints — N/S/E/W openings).
      const w = 280, t = 30, gap = 80, half = 200;
      // Top wall (split around cardinal opening)
      o.push({ x: cx - half - w/2, y: cy - half - t/2, w: (w - gap)/2 + 100, h: t, type: 'neon_wall' });
      o.push({ x: cx + gap/2,       y: cy - half - t/2, w: (w - gap)/2 + 100, h: t, type: 'neon_wall' });
      // Bottom
      o.push({ x: cx - half - w/2, y: cy + half - t/2, w: (w - gap)/2 + 100, h: t, type: 'neon_wall' });
      o.push({ x: cx + gap/2,       y: cy + half - t/2, w: (w - gap)/2 + 100, h: t, type: 'neon_wall' });
      // Left
      o.push({ x: cx - half - t/2, y: cy - half - w/2, w: t, h: (w - gap)/2 + 100, type: 'neon_wall' });
      o.push({ x: cx - half - t/2, y: cy + gap/2,       w: t, h: (w - gap)/2 + 100, type: 'neon_wall' });
      // Right
      o.push({ x: cx + half - t/2, y: cy - half - w/2, w: t, h: (w - gap)/2 + 100, type: 'neon_wall' });
      o.push({ x: cx + half - t/2, y: cy + gap/2,       w: t, h: (w - gap)/2 + 100, type: 'neon_wall' });
      return o;
    })(),
    spawns: [{ x: 1500, y: 1500, radius: 80 }],
  },

  graveyard: {
    name: 'Forsaken Graveyard',
    width: 3000, height: 3000,
    tileset: 'graveyard',
    terrainEffect: { type: 'damage', dps: 5 },     // cursed scorched ground

    obstacles: [
      // Tombstone rows
      { x:  500, y:  500, w: 80, h: 30, type: 'tomb' },
      { x:  700, y:  500, w: 80, h: 30, type: 'tomb' },
      { x:  900, y:  500, w: 80, h: 30, type: 'tomb' },
      { x:  500, y:  700, w: 80, h: 30, type: 'tomb' },
      { x:  700, y:  700, w: 80, h: 30, type: 'tomb' },
      { x: 2000, y:  500, w: 80, h: 30, type: 'tomb' },
      { x: 2200, y:  500, w: 80, h: 30, type: 'tomb' },
      { x: 2000, y:  700, w: 80, h: 30, type: 'tomb' },
      { x: 2200, y:  700, w: 80, h: 30, type: 'tomb' },
      { x:  500, y: 2200, w: 80, h: 30, type: 'tomb' },
      { x:  700, y: 2200, w: 80, h: 30, type: 'tomb' },
      { x: 2200, y: 2200, w: 80, h: 30, type: 'tomb' },
      { x: 2000, y: 2200, w: 80, h: 30, type: 'tomb' },
      // Mausoleum walls (centre)
      { x: 1300, y: 1100, w: 400, h: 40, type: 'wall' },
      { x: 1300, y: 1400, w: 400, h: 40, type: 'wall' },
    ],
    spawns: [{ x: 1500, y: 1700, radius: 150 }],
  },
};

// Obstacle types that block projectiles (trees do not — projectiles
// pass through foliage). Cached as a Set so the projectile loop is
// O(1) per check instead of comparing strings.
export const PROJECTILE_BLOCKERS = new Set(['wall', 'pillar', 'tomb', 'neon_wall', 'neon_pillar']);

