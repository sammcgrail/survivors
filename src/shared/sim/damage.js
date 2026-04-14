// Damage application + on-kill consequences (gem drop, heart drop, kill
// count). Pure sim — emits ENEMY_HIT / ENEMY_KILLED for the client to
// turn into sfx, floating text, particles.
import { spawnGem } from './gems.js';
import { EVT, emit } from './events.js';

// Heart drop chance per enemy type, gated on wave 6+. Tougher enemies
// drop more often; bosses always drop.
function heartDropChance(name) {
  if (name === 'boss') return 1.0;
  if (name === 'elite' || name === 'brute') return 0.25;
  return 0.12;
}

export function spawnHeart(g, x, y, heal) {
  g.heartDrops.push({ x, y, heal, radius: 8, life: 12, bobPhase: g.rng.range(0, Math.PI * 2) });
}

export function damageEnemy(g, e, dmg, killerId) {
  if (e.dying) return; // already dead, ignore further damage
  e.hp -= dmg;
  e.hitFlash = 1;
  // damage numbers gated to dmg >= 5 to avoid floating-text spam from
  // breath ticks. Client decides what to render based on the dmg value.
  emit(g, EVT.ENEMY_HIT, { x: e.x, y: e.y, radius: e.radius, dmg });
  if (e.hp <= 0) {
    spawnGem(g, e.x, e.y, e.xp);
    if (g.wave >= 6 && g.rng.random() < heartDropChance(e.name)) {
      spawnHeart(g, e.x, e.y, 15);
    }
    emit(g, EVT.ENEMY_KILLED, { x: e.x, y: e.y, color: e.color, name: e.name });
    e.dying = 0.2; // 200ms death animation
    g.kills++;
    for (const p of g.players) if (p.id === killerId) { p.kills++; break; }
  }
}
