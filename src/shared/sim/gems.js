// XP gem subsystem. Pure sim — no DOM, no canvas, no audio. Side-effects
// the client cares about (sfx, particles, floating text, level-up modal)
// are emitted as events into g.events; client decides what to render.
import { XP_MAGNET_SPEED, XP_RADIUS } from '../constants.js';
import { EVT, emit } from './events.js';

// Tier-per-enemy multiplier. Barnaldo flagged a brick-wall XP falloff at
// wave 35 — enemy xp scales linearly with wave while xpToLevel scales
// geometrically, so tough enemies need to pay out chunkier gems to keep
// the late-game curve playable.
const GEM_MULTIPLIER = {
  boss: 25,
  brute: 5,
  elite: 3,
  spawner: 3,
};

// Gem tier integer (0-3). Drives render scale + color in drawGem and
// the snapshot field for MP. Common gems stay tier 0; tougher enemies
// bump up a bracket each, with boss carving its own tier.
const GEM_TIER = {
  boss: 3,
  brute: 2,
  elite: 1,
  spawner: 1,
};

export function spawnGem(g, x, y, xp, enemyName) {
  const mult = (enemyName && GEM_MULTIPLIER[enemyName]) || 1;
  const tier = (enemyName && GEM_TIER[enemyName]) || 0;
  g.gems.push({ x, y, xp: xp * mult, tier, radius: XP_RADIUS });
}

// Magnet pull + pickup + level-up trigger. Mutates g.gems and the
// nearest alive player. LEVEL_UP payload includes pid so the client can
// route the upgrade modal to the right player in MP.
//
// magnetBoost: per-player timer (seconds) set by the magnet consumable.
// While > 0, the player pulls every gem on the map at 4x speed — the
// VS-style "screen sweep" effect where everything streams toward you
// in ~1 second. Decays once per tick (below, outside the gem loop).
export function updateGems(g, dt) {
  // Decay magnetBoost timers once per tick (before gem loop).
  for (const p of g.players) {
    if (p.magnetBoost > 0) p.magnetBoost = Math.max(0, p.magnetBoost - dt);
  }

  for (let i = g.gems.length - 1; i >= 0; i--) {
    const gem = g.gems[i];
    let pulled = false;
    for (const p of g.players) {
      if (!p.alive) continue;
      const gdx = p.x - gem.x;
      const gdy = p.y - gem.y;
      const dist = Math.sqrt(gdx * gdx + gdy * gdy);
      const boosting = p.magnetBoost > 0;
      const range = boosting ? Infinity : p.magnetRange;
      if (dist < range && !pulled) {
        // Boost mode pulls 4x faster so distant gems arrive within
        // the ~1s window. 3000-unit maps → ≤3000/(400*4) = ~1.88s
        // worst case, but clumps near the player arrive first so the
        // effect reads as instant-sweep.
        const pull = XP_MAGNET_SPEED * (boosting ? 4 : 1) * dt;
        gem.x += (gdx / dist) * Math.min(pull, dist);
        gem.y += (gdy / dist) * Math.min(pull, dist);
        pulled = true;
      }
      if (dist < p.radius + gem.radius) {
        const xpGain = Math.floor(gem.xp * (p.xpMulti || 1));
        p.xp += xpGain;
        emit(g, EVT.GEM_PICKUP, { x: gem.x, y: gem.y, xp: xpGain, pid: p.id });
        g.gems.splice(i, 1);
        // Level-up cascade — one gem may unlock multiple levels at low xp.
        while (p.xp >= p.xpToLevel) {
          p.xp -= p.xpToLevel;
          p.level++;
          // Flattened 1.30 → 1.22 per barnaldo's W35 falloff report.
          // Geometric 1.30 vs linear enemy xp made L36+ a brick wall.
          p.xpToLevel = Math.floor(p.xpToLevel * 1.22);
          emit(g, EVT.LEVEL_UP, { level: p.level, pid: p.id });
        }
        break;
      }
    }
  }
}
