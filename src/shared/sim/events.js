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
  HEART_PICKUP:        'heartPickup',
  LEVEL_UP:            'levelUp',
  WEAPON_FIRE:         'weaponFire',
  METEOR_WARN:         'meteorWarn',
  METEOR_EXPLODE:      'meteorExplode',
  CHAIN_ZAP:           'chainZap',
  SHIELD_HUM:          'shieldHum',
  BOSS_STEP:           'bossStep',
  BOSS_TELEGRAPH:      'bossTelegraph',
  CHARGE_BURST:        'chargeBurst',
  HIVE_BURST:          'hiveBurst',
  BOSS_SPAWN:          'bossSpawn',
  EVOLUTION:           'evolution',
  WAVE_SURVIVED:       'waveSurvived',
  CONSUMABLE_SPAWN:    'consumableSpawn',
  CONSUMABLE_PICKUP:   'consumablePickup',
  ENEMY_SHOOT:         'enemyShoot',
  ENEMY_AIM:           'enemyAim',
  BOSS_PHASE:          'bossPhase',
  STATUS_APPLIED:      'statusApplied',
  STATUS_EXPIRED:      'statusExpired',
};

// Spread payload first so a stray `type` field in the payload (e.g.
// consumables shipping a `ctype` discriminator) can't silently
// overwrite the event-type tag that drives client dispatch. seb hit
// this exact bug landing the consumable feature — caught it then,
// hardening the helper here so it can't recur.
export function emit(g, type, payload) {
  g.events.push({ ...payload, type });
}
