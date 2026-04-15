// Authoritative one-frame sim tick. Order is load-bearing:
// - waves first so newly-spawned enemies see this frame's projectiles
// - weapons fire BEFORE projectiles tick so freshly-spawned bullets get one move
// - auras AFTER projectiles so they see post-impact enemy positions (matches
//   the original ordering in main.js)
// - enemies last among damage sources (movement + repulsion + player contact)
// - gems pull last since they only react to player position
// - chain/meteor effect lifetimes drain after everything that emitted them
import { updateWaves } from './waves.js';
import { updateWeapons, updateAuras, updateChainEffects, updateMeteorEffects } from './weapons_runtime.js';
import { updateProjectiles } from './projectiles.js';
import { updateEnemies } from './enemies.js';
import { updateGems } from './gems.js';
import { updateHearts } from './hearts.js';
import { updateTerrain } from './terrain.js';

export function tickSim(g, dt) {
  updateTerrain(g, dt);          // sets p._terrainSlow, applies hostile DoT
  updateWaves(g, dt);
  updateWeapons(g, dt);
  updateProjectiles(g, dt);
  updateAuras(g, dt);
  updateEnemies(g, dt);
  updateGems(g, dt);
  updateHearts(g, dt);
  updateChainEffects(g, dt);
  updateMeteorEffects(g, dt);
}
