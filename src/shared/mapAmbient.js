// Per-map ambient VFX — spawns small decorative particles every frame
// to give each map its own visual identity. Pure client-side cosmetic:
// no sim involvement, no event emission, doesn't affect gameplay.
//
// Each generator takes `(particles, viewport, time)` where:
//   particles — client particle array to push into
//   viewport  — { cx, cy, W, H } camera window so spawns happen where
//               the player can see them (off-screen motes would be
//               wasted particle budget)
//   time      — performance.now() for phase-based animation
//
// Particle budgets are tight — most generators spawn 0-2 particles per
// frame via Math.random() gates. At 60fps that's ~60-120/sec, all
// short-lived (<1s), so total live ambient particles stay under ~80
// even in the busiest case. Caller wraps this in a feature check, so
// maps without `ambient` pay zero cost.
//
// To add a map: return an object with a `tick(particles, viewport, time)`
// method from the `getAmbient(mapId)` dispatcher. Keep effects
// thematically distinct — the point is map identity, not prettier chaos.

function randIn(min, max) { return min + Math.random() * (max - min); }

function randomInViewport(viewport, inset = 0) {
  return {
    x: viewport.cx + inset + Math.random() * (viewport.W - inset * 2),
    y: viewport.cy + inset + Math.random() * (viewport.H - inset * 2),
  };
}

// Arena — warm ember sparks rising from the ground. Sparse, dim,
// "open field catching the last light" feel.
function arenaAmbient(particles, viewport) {
  if (Math.random() < 0.35) {
    const { x, y } = randomInViewport(viewport);
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 12,
      vy: -randIn(20, 40),
      life: 1.0 + Math.random() * 0.4,
      maxLife: 1.4,
      radius: 0.8 + Math.random() * 0.6,
      color: Math.random() < 0.6 ? '#f39c12' : '#e67e22',
    });
  }
}

// Forest + Wilderness — fireflies. Soft green motes drifting in random
// directions, longer life, light-yellow core tint.
function forestAmbient(particles, viewport) {
  if (Math.random() < 0.45) {
    const { x, y } = randomInViewport(viewport);
    const angle = Math.random() * Math.PI * 2;
    const speed = randIn(8, 18);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.4 + Math.random() * 0.6,
      maxLife: 2.0,
      radius: 1.2 + Math.random() * 0.6,
      color: Math.random() < 0.7 ? '#a7f3c4' : '#f1fa8c',
    });
  }
}

// Ruins + Catacombs — torch flicker + falling dust motes. Torches
// anchor near static positions (seeded per frame from a slow-rotating
// grid so they stay "placed" even without per-torch state), dust motes
// drift down at low speed.
function ruinsAmbient(particles, viewport, time) {
  // Torch flicker — 1 spark/frame pushed at a viewport-relative grid
  // cell. Time-phased index so the "torch" moves between several
  // virtual wall positions over seconds, giving the room a sense of
  // multiple active flames without tracking per-torch state.
  if (Math.random() < 0.5) {
    const slot = Math.floor(time / 1200) % 6;
    const slotX = [0.12, 0.33, 0.55, 0.72, 0.88, 0.20][slot];
    const slotY = [0.18, 0.82, 0.35, 0.65, 0.28, 0.55][slot];
    const x = viewport.cx + viewport.W * slotX + (Math.random() - 0.5) * 8;
    const y = viewport.cy + viewport.H * slotY + (Math.random() - 0.5) * 8;
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 8,
      vy: -randIn(18, 32),
      life: 0.5 + Math.random() * 0.25,
      maxLife: 0.75,
      radius: 1.2 + Math.random() * 0.8,
      color: Math.random() < 0.7 ? '#f39c12' : '#ffd27f',
    });
  }
  // Dust motes — sparse, slow falling, near-top of viewport bias.
  if (Math.random() < 0.25) {
    const { x } = randomInViewport(viewport);
    particles.push({
      x,
      y: viewport.cy - 4,
      vx: (Math.random() - 0.5) * 4,
      vy: randIn(8, 18),
      life: 2.0 + Math.random(),
      maxLife: 3.0,
      radius: 0.8 + Math.random() * 0.4,
      color: '#d2c49a',
    });
  }
}

// Neon — glitch flecks. Short-lived cyan/magenta/green pixels that
// jitter, fit the code-render aesthetic.
function neonAmbient(particles, viewport) {
  if (Math.random() < 0.55) {
    const { x, y } = randomInViewport(viewport);
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 80,
      vy: (Math.random() - 0.5) * 80,
      life: 0.18 + Math.random() * 0.12,
      maxLife: 0.3,
      radius: 1.0 + Math.random() * 0.6,
      color: ['#00ffff', '#ff00ff', '#00ff88'][Math.floor(Math.random() * 3)],
    });
  }
}

// Graveyard — pale cold-blue mist wisps drifting upward, long life,
// low opacity feel via small radius. Reads as rising fog.
function graveyardAmbient(particles, viewport) {
  if (Math.random() < 0.35) {
    const { x, y } = randomInViewport(viewport);
    particles.push({
      x, y: y + 10,
      vx: (Math.random() - 0.5) * 8,
      vy: -randIn(12, 22),
      life: 1.6 + Math.random() * 0.8,
      maxLife: 2.4,
      radius: 1.6 + Math.random() * 1.2,
      color: Math.random() < 0.5 ? '#b0c4de' : '#e0e8f0',
    });
  }
}

const AMBIENT_BY_MAP = {
  arena:      { tick: arenaAmbient },
  forest:     { tick: forestAmbient },
  wilderness: { tick: forestAmbient }, // shares forest flavor
  ruins:      { tick: ruinsAmbient },
  catacombs:  { tick: ruinsAmbient },   // shares ruins flavor
  neon:       { tick: neonAmbient },
  graveyard:  { tick: graveyardAmbient },
};

export function getAmbient(mapId) {
  return AMBIENT_BY_MAP[mapId] || null;
}
