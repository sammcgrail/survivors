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
// Lookahead-only — project the current velocity forward `lookAhead`
// units; if the tip is inside an obstacle, steer perpendicular to the
// velocity, away from the obstacle centre. This curves the entity
// around walls instead of slamming. Hard contact correction is left
// to pushOutOfObstacles in the same tick.
//
// Earlier iteration also did a proximity radial push, but it
// overpowered chase right at the wall edge (proximity west + chase
// east normalize to pure west) and made enemies oscillate in a
// 4-tick cycle. Lookahead alone routes them around cleanly.
export function obstacleAvoidance(x, y, vx, vy, obstacles, lookAhead) {
  const speed = Math.hypot(vx, vy);
  if (speed < 0.001) return { x: 0, y: 0 }; // stationary — nothing to project
  const dx = vx / speed, dy = vy / speed;
  const tipX = x + dx * lookAhead;
  const tipY = y + dy * lookAhead;
  let ax = 0, ay = 0;
  for (const o of obstacles) {
    const nx = Math.max(o.x, Math.min(tipX, o.x + o.w));
    const ny = Math.max(o.y, Math.min(tipY, o.y + o.h));
    const tdx = tipX - nx, tdy = tipY - ny;
    if (tdx * tdx + tdy * tdy > 0.01) continue; // tip clear of this obstacle
    const ocx = o.x + o.w * 0.5;
    const ocy = o.y + o.h * 0.5;
    const perpX = -dy, perpY = dx;
    const sign = (perpX * (ocx - x) + perpY * (ocy - y)) < 0 ? 1 : -1;
    ax += perpX * sign;
    ay += perpY * sign;
  }
  return { x: ax, y: ay };
}
