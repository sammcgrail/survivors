// Damage application + on-kill consequences (gem drop, heart drop, kill
// count). Pure sim — emits ENEMY_HIT / ENEMY_KILLED for the client to
// turn into sfx, floating text, particles.
import { spawnGem } from './gems.js';
import { EVT, emit } from './events.js';
import { consumableDrop, spawnConsumable } from './consumables.js';

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
  // dmg < 5 hits never trigger client visuals (text/sfx/crit gated
  // at >= 5), so skip emission server-side. Drops the bandwidth
  // pressure from breath weapons fanning out across many enemies
  // every tick — was the dominant event volume in 8-player MP.
  if (dmg >= 5) {
    emit(g, EVT.ENEMY_HIT, { x: e.x, y: e.y, radius: e.radius, dmg });
  }
  if (e.hp <= 0) {
    spawnGem(g, e.x, e.y, e.xp);
    if (g.wave >= 6 && g.rng.random() < heartDropChance(e.name)) {
      spawnHeart(g, e.x, e.y, 15);
    }
    // Consumable drops — elite/brute/boss only. Wave 4+ so players
    // learn the basic loop before consumables appear.
    if (g.wave >= 4) {
      const cType = consumableDrop(e.name, g.rng);
      if (cType) spawnConsumable(g, e.x, e.y, cType);
    }
    // Death VFX is driven entirely by the ENEMY_KILLED event in
    // applySimEvent now — per-enemy personality bursts replace the
    // old uniform meteor-ring so kills don't all read like a meteor
    // explosion. Velocity / motion direction lets the renderer
    // shape an asymmetric burst (forward shred for fast enemies,
    // chunky downward debris for tanks, etc).
    emit(g, EVT.ENEMY_KILLED, {
      x: e.x, y: e.y,
      color: e.color, name: e.name, radius: e.radius,
      vx: e.vx, vy: e.vy,
      killer: killerId,
    });
    e.dying = 0.2; // 200ms death animation
    g.kills++;
    for (const p of g.players) if (p.id === killerId) { p.kills++; break; }
    return true;
  }
  return false;
}
