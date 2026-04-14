// Pure data + scaling math for enemies. Used by both v1a (single-player
// client) and — eventually — v1b's server.py port to JS, if/when that
// happens. Keep this file free of DOM, canvas, and game-state references.

export const ENEMY_TYPES = [
  { name: 'blob',   hp: 20,  speed: 55,  radius: 10, color: '#2ecc71', damage: 8,  xp: 10, sprite: 'blob' },
  { name: 'fast',   hp: 10,  speed: 130, radius: 7,  color: '#1abc9c', damage: 4,  xp: 8,  sprite: 'fast' },
  { name: 'tank',   hp: 80,  speed: 30,  radius: 18, color: '#e67e22', damage: 18, xp: 30, sprite: 'tank' },
  { name: 'swarm',  hp: 6,   speed: 85,  radius: 5,  color: '#fd79a8', damage: 2,  xp: 4,  sprite: 'swarm' },
  { name: 'brute',  hp: 150, speed: 22,  radius: 24, color: '#e74c3c', damage: 30, xp: 60, sprite: 'brute' },
  { name: 'ghost',  hp: 15,  speed: 100, radius: 9,  color: '#a29bfe', damage: 6,  xp: 12, sprite: 'skull' },
  { name: 'elite',  hp: 300, speed: 45,  radius: 20, color: '#6c5ce7', damage: 25, xp: 80, sprite: 'elite' },
  { name: 'spawner',hp: 100, speed: 15,  radius: 22, color: '#fdcb6e', damage: 10, xp: 50, sprite: 'spawner' },
  { name: 'boss',   hp: 2000,speed: 35,  radius: 40, color: '#d63031', damage: 50, xp: 500,sprite: 'boss' },
];

// Wave composition tables — weights for each enemy type per wave bracket
export const WAVE_POOLS = [
  { maxWave: 2,  weights: { blob: 5, swarm: 3 } },
  { maxWave: 4,  weights: { blob: 4, swarm: 4, fast: 2 } },
  { maxWave: 6,  weights: { blob: 3, swarm: 3, fast: 3, tank: 1 } },
  { maxWave: 9,  weights: { blob: 2, swarm: 4, fast: 3, tank: 2, ghost: 2 } },
  { maxWave: 12, weights: { blob: 1, swarm: 5, fast: 3, tank: 3, ghost: 2, brute: 1 } },
  { maxWave: 17, weights: { blob: 1, swarm: 6, fast: 4, tank: 3, ghost: 3, brute: 2 } },
  { maxWave: 999,weights: { swarm: 5, fast: 4, tank: 3, ghost: 4, brute: 3, elite: 1, spawner: 1 } },
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

export function enemyType(wave) {
  const special = SPECIAL_WAVES[wave];
  if (special && special.override) {
    const base = ENEMY_TYPES.find(t => t.name === special.override);
    return scaleEnemy(base, wave);
  }
  const pool = WAVE_POOLS.find(p => wave <= p.maxWave) || WAVE_POOLS[WAVE_POOLS.length - 1];
  const entries = Object.entries(pool.weights);
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * totalWeight;
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll <= 0) {
      const base = ENEMY_TYPES.find(t => t.name === name);
      return scaleEnemy(base, wave);
    }
  }
  return scaleEnemy(ENEMY_TYPES[0], wave);
}

export function scaleEnemy(base, wave) {
  // HP scales quadratically — enemies get tanky fast after wave 8
  const hpScale = 1 + (wave - 1) * 0.12 + Math.max(0, wave - 8) * 0.08;
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
    orbitSign: Math.random() < 0.5 ? 1 : -1,
    spawnTimer: base.name === 'spawner' ? 2 + Math.random() * 2 : 0, // spawners birth swarms
  };
}
