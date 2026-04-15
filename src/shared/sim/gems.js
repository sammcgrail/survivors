// XP gem subsystem. Pure sim — no DOM, no canvas, no audio. Side-effects
// the client cares about (sfx, particles, floating text, level-up modal)
// are emitted as events into g.events; client decides what to render.
import { XP_MAGNET_SPEED, XP_RADIUS } from '../constants.js';
import { EVT, emit } from './events.js';

export function spawnGem(g, x, y, xp) {
  g.gems.push({ x, y, xp, radius: XP_RADIUS });
}

// Magnet pull + pickup + level-up trigger. Mutates g.gems and the
// nearest alive player. LEVEL_UP payload includes pid so the client can
// route the upgrade modal to the right player in MP.
export function updateGems(g, dt) {
  for (let i = g.gems.length - 1; i >= 0; i--) {
    const gem = g.gems[i];
    let pulled = false;
    for (const p of g.players) {
      if (!p.alive) continue;
      const gdx = p.x - gem.x;
      const gdy = p.y - gem.y;
      const dist = Math.sqrt(gdx * gdx + gdy * gdy);
      if (dist < p.magnetRange && !pulled) {
        const pull = XP_MAGNET_SPEED * dt;
        gem.x += (gdx / dist) * Math.min(pull, dist);
        gem.y += (gdy / dist) * Math.min(pull, dist);
        pulled = true;
      }
      if (dist < p.radius + gem.radius) {
        p.xp += gem.xp;
        emit(g, EVT.GEM_PICKUP, { x: gem.x, y: gem.y, xp: gem.xp, pid: p.id });
        g.gems.splice(i, 1);
        // Level-up cascade — one gem may unlock multiple levels at low xp.
        while (p.xp >= p.xpToLevel) {
          p.xp -= p.xpToLevel;
          p.level++;
          p.xpToLevel = Math.floor(p.xpToLevel * 1.30);
          emit(g, EVT.LEVEL_UP, { level: p.level, pid: p.id });
        }
        break;
      }
    }
  }
}
