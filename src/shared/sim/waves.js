// Wave progression + spawn-burst scheduling. Pure sim: emits
// WAVE_START / SPECIAL_WAVE_START events for the client to render
// announcement banners. Spawn rate decay is a closed-form curve;
// special waves multiply the burst count.
import { SPECIAL_WAVES } from '../enemyTypes.js';
import { EVT, emit } from './events.js';
import { spawnEnemy } from './enemies.js';

export function updateWaves(g, dt) {
  // wave progression
  if (g.waveTimer >= g.waveDuration) {
    g.wave++;
    g.waveTimer = 0;
    g.deathFeed.push({ text: `${g.playerName} survived wave ${g.wave - 1}`, time: g.time });
    // spawn rate curve: fast early ramp, then gradual
    g.spawnRate = Math.max(0.3, 2.0 * Math.pow(0.90, g.wave - 1));
    g.waveMsg = `WAVE ${g.wave}`;
    g.waveMsgTimer = 2.0;
    emit(g, EVT.WAVE_START, { wave: g.wave });
    const special = SPECIAL_WAVES[g.wave];
    if (special) {
      g.specialWaveMsg = special.name;
      g.specialWaveMsgTimer = 2.5;
      emit(g, EVT.SPECIAL_WAVE_START, { wave: g.wave, name: special.name });
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
