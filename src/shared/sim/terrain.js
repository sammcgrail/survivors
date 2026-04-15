// Terrain effect tick — runs once per sim tick. Sets `p._terrainSlow`
// for each player based on whether they're standing on a lower-terrain
// patch, and applies damage-over-time when the patch is hostile (cursed
// graveyard, lava). Movement code (SP main.js + server.mjs) reads
// `p._terrainSlow` to scale dx/dy.
//
// Effects come from `MAPS[mapId].terrainEffect`:
//   { type: 'slow', factor: 0.55 } — multiply movement
//   { type: 'damage', dps: 5 }     — apply hp loss per second
import { MAPS } from '../maps.js';
import { isOnPatch } from '../mapTerrain.js';
import { EVT, emit } from './events.js';

export function updateTerrain(g, dt) {
  const effect = MAPS[g.mapId]?.terrainEffect;
  if (!effect) {
    for (const p of g.players) p._terrainSlow = 1;
    return;
  }
  for (const p of g.players) {
    if (!p.alive) { p._terrainSlow = 1; continue; }
    const onPatch = isOnPatch(g.mapId, p.x, p.y);
    if (!onPatch) { p._terrainSlow = 1; continue; }
    if (effect.type === 'slow') {
      p._terrainSlow = effect.factor;
    } else if (effect.type === 'damage') {
      p._terrainSlow = 1;
      p.hp -= effect.dps * dt;
      if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
        emit(g, EVT.PLAYER_DEATH, { x: p.x, y: p.y, by: 'cursed_ground', pid: p.id });
      }
    }
  }
}
