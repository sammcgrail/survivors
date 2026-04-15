// Circle-vs-AABB collision used for player/enemy/projectile vs obstacle
// checks. Pure math — no game-state references, importable anywhere.
//
// `nearest` clamps the circle centre into the rect; the squared
// distance from there to the centre tells us if they overlap. Used
// by the maps system (src/shared/maps.js) when a tick updates a
// circular entity's position.

export function circleRectCollision(cx, cy, cr, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < cr * cr;
}

// When a circle is overlapping a rect, returns the {x, y} push vector
// to move the circle out (along the shortest path). Returns null when
// not overlapping (or perfectly centred — caller handles the edge case
// by leaving the entity in place).
export function resolveCircleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= cr * cr || d2 < 0.0001) return null;
  const d = Math.sqrt(d2);
  const push = cr - d;
  return { x: (dx / d) * push, y: (dy / d) * push };
}

// Push a circle out of every obstacle in the list. Idempotent — call
// after every movement step. `pierces` → tree-style obstacles that
// don't block movement (caller filters before passing in).
export function pushOutOfObstacles(circle, obstacles) {
  for (const obs of obstacles) {
    const push = resolveCircleRect(circle.x, circle.y, circle.radius, obs.x, obs.y, obs.w, obs.h);
    if (push) { circle.x += push.x; circle.y += push.y; }
  }
}
