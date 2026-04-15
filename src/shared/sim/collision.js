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
// Works in two passes:
//   1. Find the strongest nearby obstacle ahead of us (closest /
//      largest overlap). Its geometry determines which side of the
//      velocity we steer toward — so when two obstacles meet at a
//      corner, we don't pick opposing sides that cancel to zero.
//   2. Sum perpendicular pushes for every obstacle within range,
//      all along the side chosen in pass 1, with linear falloff.
//
// Fallback: if no obstacle is "ahead" (forward component ≥ 0) but
// we're overlapping one (pushOut couldn't fully resolve in a single
// tick), we push straight backward along −velocity so the entity
// retreats rather than grinding against the rect.
export function obstacleAvoidance(x, y, vx, vy, obstacles, lookAhead) {
  const speed = Math.hypot(vx, vy);
  if (speed < 0.001) return { x: 0, y: 0 };
  const dx = vx / speed, dy = vy / speed;
  const perpX = -dy, perpY = dx;
  const lookAhead2 = lookAhead * lookAhead;

  // Pass 1 — find the strongest ahead obstacle to decide the steering side.
  let bestStrength = 0;
  let bestLateral = 0;
  let overlapping = false;
  for (const o of obstacles) {
    const nx = Math.max(o.x, Math.min(x, o.x + o.w));
    const ny = Math.max(o.y, Math.min(y, o.y + o.h));
    const rdx = nx - x, rdy = ny - y;
    const d2 = rdx * rdx + rdy * rdy;
    if (d2 < 0.0001) { overlapping = true; continue; }  // inside the rect
    const forward = rdx * dx + rdy * dy;
    if (forward <= 0) continue;                         // obstacle behind
    if (d2 >= lookAhead2) continue;
    const strength = 1 - Math.sqrt(d2) / lookAhead;
    if (strength > bestStrength) {
      bestStrength = strength;
      // Signed lateral offset of the entity *relative to the obstacle*
      // on the perpendicular axis. Using the rect centre keeps the
      // choice stable across the obstacle's whole face.
      bestLateral = perpX * (x - (o.x + o.w * 0.5)) + perpY * (y - (o.y + o.h * 0.5));
    }
  }

  // Overlapping and nothing "ahead" to route around: reverse course.
  if (bestStrength === 0) {
    return overlapping ? { x: -dx, y: -dy } : { x: 0, y: 0 };
  }

  // Pass 2 — accumulate perpendicular pushes, all on the same side.
  // `>= 0` bias: ties consistently pick +perp so enemies on the exact
  // midline of a thin rect don't flip-flop and clash.
  const sign = bestLateral >= 0 ? 1 : -1;
  let ax = 0, ay = 0;
  for (const o of obstacles) {
    const nx = Math.max(o.x, Math.min(x, o.x + o.w));
    const ny = Math.max(o.y, Math.min(y, o.y + o.h));
    const rdx = nx - x, rdy = ny - y;
    const d2 = rdx * rdx + rdy * rdy;
    if (d2 < 0.0001) continue;
    const forward = rdx * dx + rdy * dy;
    if (forward <= 0 || d2 >= lookAhead2) continue;
    const strength = 1 - Math.sqrt(d2) / lookAhead;
    ax += perpX * sign * strength;
    ay += perpY * sign * strength;
  }
  return { x: ax, y: ay };
}
