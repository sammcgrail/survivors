// Pure data + scaling math for enemies. Shared by SP (src/main.js) and
// MP (server.mjs). Keep free of DOM/canvas/game-state references.
//
// `enemyType` and `scaleEnemy` take an `rng` (object with `.random()` —
// see shared/sim/rng.js) so spawn rolls + per-enemy jitter are
// reproducible from the same seed. Required, not optional — the whole
// point of plumbing rng through the sim is to avoid a hidden Math.random
// reintroducing nondeterminism.

// Boids-style flocking weights per enemy type. Each enemy's movement is
// the weighted blend of: chase nearest player, separate from same-type
// neighbors, align with their headings, cohere toward their center of
// mass. Ghost + boss skip flocking (have custom AI). Numbers are tuned
// to give each type a distinct movement personality:
//   swarm  — tight swirling packs (high align + cohesion)
//   blob   — moderate horde
//   fast   — scattered flankers (high separation, low cohesion)
//   tank   — spread wall (very high separation)
//   brute  — lone chargers (zero align/coh, max chase)
//   elite  — small tactical squads
//   spawner — keep distance from each other so children spread
const F = (perceptionRadius, sepWeight, alignWeight, cohWeight, chaseWeight, sepRadius) => ({
  perceptionRadius, sepWeight, alignWeight, cohWeight, chaseWeight, sepRadius,
});

// Tuning pass 2026-04-15 (VoX): increased separation across the board
// so enemies spread out instead of clumping. Reduced cohesion (was
// pulling them toward each other's center instead of the player).
// Bumped chase weights so player-pursuit dominates over flocking.
// Widened sepRadius so repulsion kicks in earlier.
export const ENEMY_TYPES = [
  { name: 'blob',   hp: 20,  speed: 55,  radius: 10, color: '#2ecc71', damage: 8,  xp: 10, sprite: 'blob',    flock: F(120, 1.8, 0.3, 0.1, 1.5, 35) },
  { name: 'fast',   hp: 10,  speed: 130, radius: 7,  color: '#1abc9c', damage: 4,  xp: 8,  sprite: 'fast',    flock: F(150, 2.2, 0.2, 0.0, 1.8, 50) },
  { name: 'tank',   hp: 80,  speed: 30,  radius: 18, color: '#e67e22', damage: 18, xp: 30, sprite: 'tank',    flock: F(140, 2.5, 0.2, 0.1, 1.2, 60) },
  { name: 'swarm',  hp: 6,   speed: 85,  radius: 5,  color: '#fd79a8', damage: 2,  xp: 4,  sprite: 'swarm',   flock: F(100, 1.2, 0.6, 0.3, 1.4, 20) },
  { name: 'brute',  hp: 150, speed: 22,  radius: 24, color: '#e74c3c', damage: 30, xp: 60, sprite: 'brute',   flock: F( 80, 3.0, 0.0, 0.0, 2.0, 70) },
  { name: 'ghost',  hp: 15,  speed: 100, radius: 9,  color: '#a29bfe', damage: 6,  xp: 12, sprite: 'skull' },
  { name: 'elite',  hp: 300, speed: 45,  radius: 20, color: '#6c5ce7', damage: 25, xp: 80, sprite: 'elite',   flock: F(130, 2.0, 0.4, 0.2, 1.5, 45), shootCooldown: 2.0, shootDamage: 12, shootSpeed: 180, shootRange: 350, statusResist: 0.5 },
  { name: 'spawner',hp: 100, speed: 15,  radius: 22, color: '#fdcb6e', damage: 10, xp: 50, sprite: 'spawner', flock: F(100, 2.5, 0.1, 0.0, 0.8, 60), statusResist: 0.3 },
  { name: 'boss',   hp: 2000,speed: 35,  radius: 40, color: '#d63031', damage: 50, xp: 500,sprite: 'boss', shootCooldown: 3.0, shootDamage: 20, shootSpeed: 160, shootRange: 450, statusResist: 0.5 },
  // New variety pass 2026-04-15 (bench follow-up). Each adds one
  // distinct mechanic the existing roster didn't cover — poison DoT
  // on hit, split-on-death, explode-on-death, heal-nearby.
  // poisoner: sparser swarm-sized chaser that applies a long, strong
  // burn on contact. Rewards kiting hard — take one hit and you're
  // ticking for 4s. No sprite yet, falls back to teal circle.
  { name: 'poisoner', hp: 22, speed: 70, radius: 9,  color: '#16a085', damage: 4,  xp: 14, flock: F(110, 2.0, 0.4, 0.1, 1.5, 28), poisonOnHit: { dps: 6, duration: 4 } },
  // splitter: medium enemy that bursts into 3 swarmlings on death.
  // turns a single frontline target into a swarm problem — rewards
  // AoE finishes, punishes single-target spit pierce.
  { name: 'splitter', hp: 45, speed: 50, radius: 13, color: '#27ae60', damage: 10, xp: 22, flock: F(120, 1.8, 0.3, 0.1, 1.4, 40), splitOn: { name: 'swarm', count: 3, radius: 28 } },
  // bomber: tank-sized charger with a meteor-shaped death blast.
  // Players need to path AWAY from low-HP bombers instead of finishing
  // them at point-blank. Telegraph shake on low HP would be a v2.
  { name: 'bomber',   hp: 65, speed: 55, radius: 15, color: '#e17055', damage: 14, xp: 32, flock: F(130, 2.2, 0.2, 0.1, 1.4, 45), explodeOn: { radius: 55, damage: 22 } },
  // healer: elite-tier support that restores HP to any enemy within
  // healRadius every healInterval. Priority target — a healer in a
  // pack turns a clearable fight into attrition. Starts healing only
  // after a short delay so it doesn't heal itself out of an opener.
  { name: 'healer',   hp: 180, speed: 38, radius: 16, color: '#00b894', damage: 8, xp: 70, flock: F(120, 2.2, 0.3, 0.1, 1.1, 42), healInterval: 1.5, healAmount: 8, healRadius: 140, statusResist: 0.3 },
];

// Wave composition tables — weights for each enemy type per wave bracket
export const WAVE_POOLS = [
  { maxWave: 2,  weights: { blob: 5, swarm: 3 } },
  { maxWave: 4,  weights: { blob: 4, swarm: 4, fast: 2 } },
  { maxWave: 6,  weights: { blob: 3, swarm: 3, fast: 3, tank: 1, poisoner: 1 } },
  { maxWave: 9,  weights: { blob: 2, swarm: 4, fast: 3, tank: 2, ghost: 2, poisoner: 2, splitter: 1 } },
  { maxWave: 12, weights: { blob: 1, swarm: 5, fast: 3, tank: 3, ghost: 2, brute: 1, poisoner: 2, splitter: 2, bomber: 1 } },
  { maxWave: 17, weights: { blob: 1, swarm: 6, fast: 4, tank: 3, ghost: 3, brute: 2, poisoner: 2, splitter: 2, bomber: 2, healer: 1 } },
  { maxWave: 999,weights: { swarm: 5, fast: 4, tank: 3, ghost: 4, brute: 3, elite: 1, spawner: 1, poisoner: 2, splitter: 2, bomber: 2, healer: 1 } },
];

// Special wave events — override normal spawns
export const SPECIAL_WAVES = {
  6:  { name: 'SWARM RUSH',   override: 'swarm',  countMulti: 3 },
  7:  { name: 'PHANTOM',      override: 'ghost',  countMulti: 0.5 }, // teach: few ghosts
  9:  { name: 'TANK PARADE',  override: 'tank',   countMulti: 1.5 },
  11: { name: 'GHOST STORM',  override: 'ghost',  countMulti: 1.5 },
  13: { name: 'BRUTE FORCE',  override: 'brute',  countMulti: 1 },
  15: { name: 'THE HORDE',    override: null,      countMulti: 4 },
  17: { name: 'ELITE GUARD',  override: 'elite',   countMulti: 0.5 },
  19: { name: 'HIVE MIND',    override: 'spawner',  countMulti: 0.8 },
  20: { name: 'THE DEMON',    override: 'boss',    countMulti: 0.05 }, // single boss
};

export function enemyType(wave, rng) {
  const special = SPECIAL_WAVES[wave];
  if (special && special.override) {
    const base = ENEMY_TYPES.find(t => t.name === special.override);
    return scaleEnemy(base, wave, rng);
  }
  const pool = WAVE_POOLS.find(p => wave <= p.maxWave) || WAVE_POOLS[WAVE_POOLS.length - 1];
  const entries = Object.entries(pool.weights);
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng.random() * totalWeight;
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll <= 0) {
      const base = ENEMY_TYPES.find(t => t.name === name);
      return scaleEnemy(base, wave, rng);
    }
  }
  return scaleEnemy(ENEMY_TYPES[0], wave, rng);
}

export function scaleEnemy(base, wave, rng) {
  // HP scales — gentle ramp with gradual late-game bonus starting wave 6
  const hpScale = 1 + (wave - 1) * 0.12 + Math.max(0, wave - 6) * 0.04;
  // Speed scales gently — don't make it impossible to dodge
  const speedScale = 1 + (wave - 1) * 0.03;
  // Damage scales linearly
  const dmgScale = 1 + (wave - 1) * 0.1;
  // XP scales with HP so kills always feel rewarding
  const xpScale = hpScale * 0.9;
  return {
    ...base,
    hp: Math.floor(base.hp * hpScale),
    maxHp: Math.floor(base.hp * hpScale),
    speed: base.speed * speedScale,
    damage: Math.floor(base.damage * dmgScale),
    xp: Math.floor(base.xp * xpScale),
    hitFlash: 0,
    // Ranged attack stats — scaled like melee damage. shootTimer
    // initialized with jitter so multiple elites don't volley in sync.
    ...(base.shootCooldown ? {
      shootCooldown: base.shootCooldown,
      shootDamage: Math.floor(base.shootDamage * dmgScale),
      shootSpeed: base.shootSpeed,
      shootRange: base.shootRange,
      shootTimer: base.shootCooldown * (0.5 + rng.random() * 0.5),
    } : {}),
    orbitSign: rng.random() < 0.5 ? 1 : -1,
    // Per-AI cadence/state, initialized here so the per-tick loop never
    // has to lazy-init: spawner birth jitter, boss charge/step timers,
    // healer pulse jitter (stagger so a pack of healers doesn't tick
    // in lockstep).
    spawnTimer: base.name === 'spawner' ? 2 + rng.random() * 2 : 0,
    chargeTimer: base.name === 'boss' ? 3 + rng.random() * 2 : 0,
    charging: 0,
    stepTimer: base.name === 'boss' ? 0.8 : 0,
    healTimer: base.name === 'healer' ? base.healInterval * (0.5 + rng.random() * 0.5) : 0,
    // Velocity tracked for flock alignment (neighbors look at vx/vy).
    // Initialized to zero — first tick computes from chase + flock blend.
    vx: 0, vy: 0,
  };
}
