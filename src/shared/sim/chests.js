// Chest pickup subsystem. Chests are spawned on boss/elite kills and
// wave milestones, each containing a random relic. Walk-over auto-pickup
// like gems/hearts/consumables. Pure sim — emits events for client VFX.
import { EVT, emit } from './events.js';
import { RELICS, pickRelic } from '../relics.js';

export function spawnChest(g, x, y) {
  // Pick a relic for the first alive player (SP) or defer to pickup.
  // We store the relic_id at spawn time so the chest is deterministic.
  const p = g.players.find(pl => pl.alive) || g.players[0];
  const relic = pickRelic(p.relics || {}, g.rng);
  if (!relic) return; // all relics maxed — skip chest
  g.chests.push({
    x, y,
    radius: 14,
    relic_id: relic.id,
    bobPhase: g.rng.range(0, Math.PI * 2),
  });
  emit(g, EVT.CHEST_SPAWN, { x, y, relic_id: relic.id });
}

export function updateChests(g, dt) {
  for (let i = g.chests.length - 1; i >= 0; i--) {
    const chest = g.chests[i];
    chest.bobPhase += dt * 2.5;

    for (const p of g.players) {
      if (!p.alive) continue;
      const dx = p.x - chest.x, dy = p.y - chest.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < p.radius + chest.radius) {
        // Apply the relic
        const relic = RELICS.find(r => r.id === chest.relic_id);
        if (relic) {
          if (!p.relics) p.relics = {};
          const current = p.relics[relic.id] || 0;
          if (current < relic.max_stacks) {
            p.relics[relic.id] = current + 1;
            relic.apply(g, p);
            emit(g, EVT.RELIC_PICKUP, {
              x: chest.x, y: chest.y,
              relic_id: relic.id,
              relic_name: relic.name,
              relic_icon: relic.icon,
              pid: p.id,
            });
          }
        }
        g.chests.splice(i, 1);
        break;
      }
    }
  }
}

// Wave milestone set — chests spawn at these waves.
const MILESTONE_WAVES = new Set([10, 15, 20, 25, 30, 35, 40, 45, 50]);
export function isWaveMilestone(wave) {
  return MILESTONE_WAVES.has(wave);
}
