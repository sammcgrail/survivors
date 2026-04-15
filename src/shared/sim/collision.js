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
// to move the circle out (along the shortest path). Two cases:
// - Centre outside the rect: push along the line from nearest edge
//   point to centre (standard).
// - Centre inside the rect: pick the nearest of the four edges and
//   push perpendicular to it. Without this branch the entity would
//   stay trapped inside an obstacle whenever steering managed to
//   push the centre through the boundary on a single tick.
export function resolveCircleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= cr * cr) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    const push = cr - d;
    return { x: (dx / d) * push, y: (dy / d) * push };
  }
  // Centre inside the rect — pick the closest face.
  const dl = cx - rx, dr = (rx + rw) - cx;
  const dt = cy - ry, db = (ry + rh) - cy;
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return { x: -(dl + cr), y: 0 };
  if (m === dr) return { x: dr + cr, y: 0 };
  if (m === dt) return { x: 0, y: -(dt + cr) };
  return { x: 0, y: db + cr };
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

// Steering force that routes a moving entity around obstacles.
//
// For each obstacle, compute distance from the entity to the nearest
// point on the rect. If the obstacle is "ahead" (forward projection
// of velocity onto the nearest-point direction is positive) and
// within `lookAhead`, add a perpendicular push whose magnitude falls
// off linearly to zero at lookAhead.
//
// Why continuous falloff instead of the old in-tip-or-not boolean:
// the boolean misses near-misses (diagonal corner approach) and
// flip-flops sign when the enemy crosses the short-axis midpoint of
// a thin rect, which made enemies oscillate and clash at the midline.
// Continuous falloff + shorter-way-around sign (bias via rect
// geometry, not just centre distance) gives smooth routing.
export function obstacleAvoidance(x, y, vx, vy, obstacles, lookAhead) {
  const speed = Math.hypot(vx, vy);
  if (speed < 0.001) return { x: 0, y: 0 };
  const dx = vx / speed, dy = vy / speed;
  const perpX = -dy, perpY = dx;
  let ax = 0, ay = 0;
  for (const o of obstacles) {
    // Nearest point on the rect FROM the entity. Used to compute both
    // distance and "is this obstacle ahead?".
    const nx = Math.max(o.x, Math.min(x, o.x + o.w));
    const ny = Math.max(o.y, Math.min(y, o.y + o.h));
    const rdx = nx - x, rdy = ny - y;
    const forward = rdx * dx + rdy * dy;   // positive → obstacle ahead
    if (forward <= 0) continue;            // obstacle is behind us
    const d2 = rdx * rdx + rdy * rdy;
    if (d2 >= lookAhead * lookAhead) continue;
    const d = Math.sqrt(d2);
    const strength = 1 - d / lookAhead;    // 1 at contact, 0 at lookAhead
    // Pick the side that's closer to a free corner. For a rect we can
    // project the entity onto perpL; whichever half of the rect is on
    // the same side as the entity has a closer exit, so we steer
    // toward that side.
    const ocx = o.x + o.w * 0.5;
    const ocy = o.y + o.h * 0.5;
    const lateral = perpX * (x - ocx) + perpY * (y - ocy);
    const sign = lateral >= 0 ? 1 : -1;    // ≥0 bias: ties consistently pick +perp side
    ax += perpX * sign * strength;
    ay += perpY * sign * strength;
  }
  return { x: ax, y: ay };
}
