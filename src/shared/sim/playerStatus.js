// Player-side status effects. Currently just poison (applied by
// poisoner contact), kept separate from the enemy applyStatus system
// because players have a flatter shape — one timer + one dps value
// rather than the stacked statusEffects[] array enemies use.
//
// Tick fires every 0.5s during the timer window. Damage is reduced by
// armor (half effect, since poison ticks twice as often as a bigger
// hit would). Emits PLAYER_HIT so floating text shows + sfx fires.
import { EVT, emit } from './events.js';

export function applyPoisonToPlayer(p, dps, duration) {
  // Refresh-on-reapply: longer of existing/new duration. dps takes the
  // larger value so a fresh poisoner can ramp up an in-flight tick.
  p.poisonTimer = Math.max(p.poisonTimer || 0, duration);
  p.poisonDps = Math.max(p.poisonDps || 0, dps);
  if (p.poisonAccum === undefined) p.poisonAccum = 0;
}

export function updatePlayerStatus(g, dt) {
  for (const p of g.players) {
    if (!p.alive) continue;
    if (!p.poisonTimer || p.poisonTimer <= 0) continue;
    p.poisonTimer = Math.max(0, p.poisonTimer - dt);
    p.poisonAccum = (p.poisonAccum || 0) + dt;
    if (p.poisonAccum >= 0.5) {
      p.poisonAccum -= 0.5;
      const tick = Math.max(1, (p.poisonDps || 0) * 0.5 - (p.armor || 0) * 0.5);
      p.hp -= tick;
      emit(g, EVT.PLAYER_HIT, { x: p.x, y: p.y, dmg: tick, by: 'poison', pid: p.id });
      if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
        emit(g, EVT.PLAYER_DEATH, { x: p.x, y: p.y, by: 'poison', pid: p.id });
      }
    }
  }
}
