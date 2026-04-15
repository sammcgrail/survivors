// Authoritative one-frame sim tick. Order is load-bearing:
// - waves first so newly-spawned enemies see this frame's projectiles
// - weapons fire BEFORE projectiles tick so freshly-spawned bullets get one move
// - auras AFTER projectiles so they see post-impact enemy positions (matches
//   the original ordering in main.js)
// - enemies: movement + repulsion (no longer includes player contact)
// - collision checks AFTER enemies so positions are fully settled; hash built
//   ONCE here and shared between bullet and player hit-tests (O(n) vs two O(n))
// - gems pull last since they only react to player position
// - chain/meteor effect lifetimes drain after everything that emitted them
import { updateWaves } from './waves.js';
import { updateWeapons, updateAuras, updateChainEffects, updateMeteorEffects, updateChargeTrails, updatePendingPulls } from './weapons_runtime.js';
import { updateProjectiles } from './projectiles.js';
import { updateEnemies } from './enemies.js';
import { buildSpatialHash, checkBulletEnemyCollisions, checkEnemyPlayerCollisions } from './collision.js';
import { updateGems } from './gems.js';
import { updateHearts } from './hearts.js';
import { updateConsumables } from './consumables.js';
import { updateEnemyProjectiles } from './enemyProjectiles.js';
import { updateTerrain } from './terrain.js';
import { updatePlayerStatus } from './playerStatus.js';

export function tickSim(g, dt) {
  updateTerrain(g, dt);          // sets p._terrainSlow, applies hostile DoT
  updatePlayerStatus(g, dt);     // poisoner DoT
  updateWaves(g, dt);
  updateWeapons(g, dt);
  updateProjectiles(g, dt);      // movement + obstacle blocking only
  updateAuras(g, dt);
  updateEnemies(g, dt);          // movement + repulsion; contact moved below
  // Build the enemy spatial hash once, share it for both collision passes.
  const enemyHash = buildSpatialHash(g.enemies);
  checkBulletEnemyCollisions(g, enemyHash);
  checkEnemyPlayerCollisions(g, enemyHash);
  updatePendingPulls(g, dt);
  updateEnemyProjectiles(g, dt);
  updateGems(g, dt);
  updateHearts(g, dt);
  updateConsumables(g, dt);
  updateChainEffects(g, dt);
  updateMeteorEffects(g, dt);
  updateChargeTrails(g, dt);
}
