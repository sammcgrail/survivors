// Heart drop subsystem. Pure sim — no DOM/canvas/audio. Lifetime decay,
// gentle magnet pull when a player is close, pickup heals nearest alive
// player. Emits HEART_PICKUP for the client (sfx + floating text).
import { XP_MAGNET_SPEED } from '../constants.js';
import { EVT, emit } from './events.js';

export function updateHearts(g, dt) {
  for (let i = g.heartDrops.length - 1; i >= 0; i--) {
    const h = g.heartDrops[i];
    h.life -= dt;
    h.bobPhase += dt * 3;
    if (h.life <= 0) { g.heartDrops.splice(i, 1); continue; }
    let pickedUp = false;
    for (const p of g.players) {
      if (!p.alive) continue;
      const hdx = p.x - h.x, hdy = p.y - h.y;
      const dist = Math.sqrt(hdx * hdx + hdy * hdy);
      // Gentle magnet pull — slower than gem magnet, only at half range.
      if (dist < p.magnetRange * 0.6 && dist > 0) {
        const pull = XP_MAGNET_SPEED * 0.7 * dt;
        h.x += (hdx / dist) * Math.min(pull, dist);
        h.y += (hdy / dist) * Math.min(pull, dist);
      }
      if (dist < p.radius + h.radius) {
        const healed = Math.min(h.heal, p.maxHp - p.hp);
        p.hp = Math.min(p.maxHp, p.hp + h.heal);
        emit(g, EVT.HEART_PICKUP, { x: h.x, y: h.y, healed, pid: p.id });
        g.heartDrops.splice(i, 1);
        pickedUp = true;
        break;
      }
    }
    if (pickedUp) continue;
  }
}
