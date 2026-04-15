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

// Returns true when this call killed the enemy (enables on-kill hooks
// like meteor_orbit's mini-meteor trigger); false on hit-but-alive or
// already-dying calls.
export function damageEnemy(g, e, dmg, killerId) {
  if (e.dying) return false;
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
    emit(g, EVT.ENEMY_KILLED, { x: e.x, y: e.y, color: e.color, name: e.name, radius: e.radius });
    // Death shockwave — small expanding ring at the kill site. Sized
    // by enemy class so a boss death feels different from a swarm
    // death. Pushed onto meteorEffects so the existing render path
    // handles it in both SP and MP (server snapshot ships these).
    const ringR = e.name === 'boss' ? 220
               : e.name === 'elite' || e.name === 'spawner' ? 120
               : e.name === 'brute' || e.name === 'tank' ? 70
               : 35;
    g.meteorEffects.push({
      x: e.x, y: e.y,
      radius: ringR,
      damage: 0,                // visual-only — applied via damageEnemy already
      life: 0.35,
      phase: 'explode',
      color: e.color,
      owner: -1,                // not attributable to any player
    });
    e.dying = 0.2; // 200ms death animation
    g.kills++;
    for (const p of g.players) if (p.id === killerId) { p.kills++; break; }
    return true;
  }
  return false;
}
