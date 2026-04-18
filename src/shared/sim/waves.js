// Wave progression + spawn-burst scheduling. Spawn rate decay is a
// closed-form curve; special waves multiply the burst count. Banner
// state lives in g.waveMsg/specialWaveMsg — renderer reads them
// directly each frame, so no event needed.
import { SPECIAL_WAVES } from '../enemyTypes.js';
import { spawnEnemy } from './enemies.js';
import { EVT, emit } from './events.js';
import { spawnChest, isWaveMilestone } from './chests.js';

export function updateWaves(g, dt) {
  if (g.waveTimer >= g.waveDuration) {
    g.wave++;
    g.waveTimer = 0;
    // Emit a typed event; clients localize the deathfeed line so MP
    // doesn't say "mp survived wave N" (g.playerName is SP-only).
    emit(g, EVT.WAVE_SURVIVED, { wave: g.wave - 1, time: g.time });
    // Relic chest at wave milestones — spawns near the first alive player.
    if (isWaveMilestone(g.wave - 1)) {
      const p = g.players.find(pl => pl.alive);
      if (p) spawnChest(g, p.x + g.rng.range(-60, 60), p.y + g.rng.range(-60, 60));
    }
    g.spawnRate = Math.max(0.3, 2.0 * Math.pow(0.90, g.wave - 1));
    g.waveMsg = `WAVE ${g.wave}`;
    g.waveMsgTimer = 2.0;
    const special = SPECIAL_WAVES[g.wave];
    if (special) {
      g.specialWaveMsg = special.name;
      g.specialWaveMsgTimer = 2.5;
    }
  }

  if (g.waveMsgTimer > 0) g.waveMsgTimer -= dt;
  if (g.specialWaveMsgTimer > 0) g.specialWaveMsgTimer -= dt;

  // burst spawn — count scales with wave, special waves multiply,
  // hard cap prevents stutter at high waves.
  g.spawnTimer -= dt;
  if (g.spawnTimer <= 0) {
    const special = SPECIAL_WAVES[g.wave];
    let baseCount = 1 + Math.floor(g.wave / 2);
    if (special) baseCount = Math.ceil(baseCount * special.countMulti);
    const count = Math.min(baseCount, 12);
    const maxEnemies = 80 + g.wave * 10;
    const toSpawn = Math.min(count, maxEnemies - g.enemies.length);
    for (let i = 0; i < toSpawn; i++) spawnEnemy(g);
    g.spawnTimer = g.spawnRate;
  }
}
