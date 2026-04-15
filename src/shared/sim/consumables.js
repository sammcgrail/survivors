// Consumable pickup subsystem. Ground items that trigger on contact —
// bomb (AoE burst), shield (invuln), magnet pulse (pull all gems).
// Dropped by elite/brute/boss kills; rare random spawns.
// Pure sim — emits events for client VFX/sfx.
import { EVT, emit } from './events.js';
import { damageEnemy } from './damage.js';

// Consumable definitions — type, color, duration/effect, sprite name.
export const CONSUMABLE_TYPES = {
  bomb:   { color: '#e74c3c', radius: 10, sprite: 'bomb',   label: 'BOMB' },
  shield: { color: '#74b9ff', radius: 10, sprite: 'shield', label: 'SHIELD' },
  magnet: { color: '#f39c12', radius: 10, sprite: 'magnet', label: 'MAGNET' },
};

// Drop table — called from damage.js on kill. Returns a type string
// or null. Tougher enemies drop more often; bosses always drop.
export function consumableDrop(enemyName, rng) {
  let chance;
  if (enemyName === 'boss')   chance = 1.0;
  else if (enemyName === 'elite')  chance = 0.20;
  else if (enemyName === 'brute')  chance = 0.15;
  else if (enemyName === 'spawner') chance = 0.10;
  else return null; // common enemies don't drop consumables

  if (rng.random() >= chance) return null;

  // Weighted pick: bomb 40%, shield 30%, magnet 30%
  const roll = rng.random();
  if (roll < 0.4) return 'bomb';
  if (roll < 0.7) return 'shield';
  return 'magnet';
}

export function spawnConsumable(g, x, y, type) {
  const def = CONSUMABLE_TYPES[type];
  g.consumables.push({
    x, y, type,
    radius: def.radius,
    color: def.color,
    life: 15,         // despawn after 15s
    bobPhase: g.rng.range(0, Math.PI * 2),
  });
  emit(g, EVT.CONSUMABLE_SPAWN, { x, y, ctype: type });
}

// Apply the consumable effect to the picking-up player.
function applyEffect(g, c, p) {
  switch (c.type) {
    case 'bomb': {
      // AoE burst — damages all enemies within 150px of pickup.
      const blastR = 150;
      const blastDmg = 80 + g.wave * 10; // scales with wave
      for (const e of g.enemies) {
        if (e.dying !== undefined) continue;
        const dx = e.x - c.x, dy = e.y - c.y;
        if (dx * dx + dy * dy < blastR * blastR) {
          damageEnemy(g, e, blastDmg, p.id);
        }
      }
      break;
    }
    case 'shield':
      // 3 seconds of invulnerability via iframes.
      p.iframes = Math.max(p.iframes, 3.0);
      break;
    case 'magnet': {
      // Instantly pull all gems to the player's position. We set
      // each gem's coords to right on top of the player — the gem
      // update loop will pick them up on the next tick.
      for (const gem of g.gems) {
        gem.x = p.x + (g.rng.random() - 0.5) * 4;
        gem.y = p.y + (g.rng.random() - 0.5) * 4;
      }
      break;
    }
  }
}

export function updateConsumables(g, dt) {
  for (let i = g.consumables.length - 1; i >= 0; i--) {
    const c = g.consumables[i];
    c.life -= dt;
    c.bobPhase += dt * 2.5;
    if (c.life <= 0) { g.consumables.splice(i, 1); continue; }

    for (const p of g.players) {
      if (!p.alive) continue;
      const dx = p.x - c.x, dy = p.y - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < p.radius + c.radius) {
        applyEffect(g, c, p);
        emit(g, EVT.CONSUMABLE_PICKUP, {
          x: c.x, y: c.y, ctype: c.type, pid: p.id,
          label: CONSUMABLE_TYPES[c.type].label,
          color: c.color,
        });
        g.consumables.splice(i, 1);
        break;
      }
    }
  }
}
