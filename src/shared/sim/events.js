// Event types the sim emits to `g.events`. The client drains the queue
// each frame in handleSimEvent() to drive sfx, particles, screen shake,
// HUD flashes, etc. Keeping these as plain objects keeps the queue
// serializable for future server→client broadcast.
export const EVT = {
  ENEMY_HIT:           'enemyHit',
  ENEMY_KILLED:        'enemyKilled',
  PLAYER_HIT:          'playerHit',
  PLAYER_DEATH:        'playerDeath',
  GEM_PICKUP:          'gemPickup',
  LEVEL_UP:            'levelUp',
  WAVE_START:          'waveStart',
  SPECIAL_WAVE_START:  'specialWaveStart',
  WEAPON_FIRE:         'weaponFire',
  METEOR_WARN:         'meteorWarn',
  METEOR_EXPLODE:      'meteorExplode',
  CHAIN_ZAP:           'chainZap',
  SHIELD_HUM:          'shieldHum',
  BOSS_STEP:           'bossStep',
  BOSS_TELEGRAPH:      'bossTelegraph',
  CHARGE_BURST:        'chargeBurst',
  HIVE_BURST:          'hiveBurst',
  EVOLUTION:           'evolution',
};

export function emit(g, type, payload) {
  // payload may be omitted; keep the event shape stable.
  if (payload) g.events.push({ type, ...payload });
  else g.events.push({ type });
}
