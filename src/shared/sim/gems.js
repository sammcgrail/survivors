// XP gem subsystem. Pure sim — no DOM, no canvas, no audio. Side-effects
// the client cares about (sfx, particles, floating text, level-up modal)
// are emitted as events into g.events; client decides what to render.
import { XP_MAGNET_SPEED, XP_RADIUS } from '../constants.js';
import { EVT, emit } from './events.js';

export function spawnGem(g, x, y, xp) {
  g.gems.push({ x, y, xp, radius: XP_RADIUS, alpha: 1 });
}

// Magnet pull + pickup + level-up trigger. Mutates g.gems and g.player.
// Emits GEM_PICKUP per pickup, LEVEL_UP per level (loop handles cascading
// levels from a single gem).
export function updateGems(g, dt) {
  const p = g.player;
  for (let i = g.gems.length - 1; i >= 0; i--) {
    const gem = g.gems[i];
    const gdx = p.x - gem.x;
    const gdy = p.y - gem.y;
    const dist = Math.sqrt(gdx * gdx + gdy * gdy);

    // magnet pull
    if (dist < p.magnetRange) {
      const pull = XP_MAGNET_SPEED * dt;
      gem.x += (gdx / dist) * Math.min(pull, dist);
      gem.y += (gdy / dist) * Math.min(pull, dist);
    }

    // pickup
    if (dist < p.radius + gem.radius) {
      p.xp += gem.xp;
      emit(g, EVT.GEM_PICKUP, { x: gem.x, y: gem.y, xp: gem.xp });
      g.gems.splice(i, 1);

      // level up cascade — one gem may unlock multiple levels at low xp
      while (p.xp >= p.xpToLevel) {
        p.xp -= p.xpToLevel;
        p.level++;
        p.xpToLevel = Math.floor(p.xpToLevel * 1.45);
        emit(g, EVT.LEVEL_UP, { level: p.level });
      }
    }
  }
}
