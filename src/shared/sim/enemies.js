// Enemy spawn + per-tick update: movement (regular, ghost orbit, boss
// charge/stalk, spawner births), hit-flash decay, player-contact
// damage, spatial-hash repulsion. Pure sim — emits events for client
// side-effects (telegraph particles, hit sfx, screen shake, etc.).
import { ENEMY_TYPES, enemyType, scaleEnemy } from '../enemyTypes.js';
import { WORLD_W, WORLD_H } from '../constants.js';
import { EVT, emit } from './events.js';
import { pushOutOfObstacles, obstacleAvoidance } from './collision.js';
import { enemyShootingAi } from './enemyProjectiles.js';
import { damageEnemy } from './damage.js';
import { applyPoisonToPlayer } from './playerStatus.js';

// Reusable zero vector for the no-obstacles path — saves an
// allocation per enemy per tick on maps without obstacles.
const ZERO_VEC = { x: 0, y: 0 };

// Apply a status effect to an enemy. Same-type effects refresh duration
// (no stacking) — caller can safely re-apply on every hit.
//
// `enemy.statusResist` (0..1) shortens incoming durations: boss/elite
// get 0.5 (half duration), spawner 0.3, trash 0 (full). Replaces the
// hard "boss immune" behavior — bosses can be slowed/burned briefly,
// just not locked down. Phase 3 dodging stays a real skill check
// (boss freeze ≈ 0.4s with the 0.5 resist) without trivializing it.
//
// effect shape: { type, remaining, magnitude, tickRate? }
export function applyStatus(g, enemy, effect) {
  if (enemy.dying !== undefined) return;
  const resist = enemy.statusResist || 0;
  const dur = effect.remaining * (1 - resist);
  if (dur <= 0) return; // resist 1.0 = full immunity
  enemy.statusEffects ??= [];
  const existing = enemy.statusEffects.find(s => s.type === effect.type);
  if (existing) {
    // Refresh — don't reset tickAccum so in-progress burn ticks aren't lost.
    existing.remaining = Math.max(existing.remaining, dur);
    return;
  }
  enemy.statusEffects.push({ ...effect, remaining: dur, tickAccum: 0 });
  emit(g, EVT.STATUS_APPLIED, { statusType: effect.type, x: enemy.x, y: enemy.y });
}

// Cell size for the spatial hash. Sized to cover the largest flock
// perception radius (150 for fast/tank) within a 1-cell neighbor
// window — so each enemy's flock query scans at most 9 cells. Repulsion
// (max sum-of-radii ~48) easily fits in the same hash.
const HASH_CELL = 150;
const HASH_KEY_STRIDE = 100000;

function buildSpatialHash(enemies) {
  const cells = new Map();
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const cx = Math.floor(e.x / HASH_CELL);
    const cy = Math.floor(e.y / HASH_CELL);
    const k = cx * HASH_KEY_STRIDE + cy;
    let bucket = cells.get(k);
    if (!bucket) { bucket = []; cells.set(k, bucket); }
    bucket.push(i);
  }
  return cells;
}

// Pick a random alive player as the spawn anchor. Falls back to the
// world centre if everyone's dead (shouldn't happen — caller skips ticks
// when alive-list is empty — but safer than indexing []).
function spawnAnchor(g) {
  const alive = g.players.filter(p => p.alive);
  if (alive.length === 0) return { x: WORLD_W / 2, y: WORLD_H / 2 };
  return alive[g.rng.int(alive.length)];
}

export function spawnEnemy(g) {
  const anchor = spawnAnchor(g);
  const angle = g.rng.random() * Math.PI * 2;
  const dist = 500 + g.rng.random() * 200;
  const ex = anchor.x + Math.cos(angle) * dist;
  const ey = anchor.y + Math.sin(angle) * dist;
  const e = enemyType(g.wave, g.rng);
  const W = g.arena ? g.arena.w : WORLD_W;
  const H = g.arena ? g.arena.h : WORLD_H;
  e.x = Math.max(e.radius, Math.min(W - e.radius, ex));
  e.y = Math.max(e.radius, Math.min(H - e.radius, ey));
  // If we landed inside an obstacle, push out so the enemy doesn't
  // start its life clipped through a wall.
  if (g.obstacles && g.obstacles.length > 0) pushOutOfObstacles(e, g.obstacles);
  g.enemies.push(e);
  // Boss arrival is a moment — emit so clients can play the
  // ominous sfx + telegraph particles + screen shake.
  if (e.name === 'boss') emit(g, EVT.BOSS_SPAWN, { x: e.x, y: e.y });
}

// Returns the alive player with the smallest distance to (ex, ey), plus
// the dx/dy/dist back to that player. Returns null when no one is alive.
function nearestAlivePlayer(g, ex, ey) {
  let nearest = null, nearestD2 = Infinity;
  for (const p of g.players) {
    if (!p.alive) continue;
    const dx = p.x - ex, dy = p.y - ey;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestD2) { nearest = p; nearestD2 = d2; }
  }
  if (!nearest) return null;
  const dx = nearest.x - ex, dy = nearest.y - ey;
  return { p: nearest, dx, dy, dist: Math.sqrt(nearestD2) };
}

// Boss steps + telegraph use g.rng for cadence so server replay stays
// in sync. Ghost orbit and movement are deterministic given current pos.
function updateBossAi(g, e, dt, edx, edy, dist) {
  // --- Phase transitions ---
  // baseSpeed captured once so phase multipliers stack cleanly off
  // the wave-scaled value set by scaleEnemy, not the base type speed.
  if (!e.phase) {
    e.phase = 1;
    e.baseSpeed = e.speed;
  }

  const hpPct = e.hp / e.maxHp;
  if (hpPct <= 0.25 && e.phase < 4) {
    // Phase 4 — enrage. Speed and movement unchanged on purpose
    // (per VoX scope); only the attack pattern tightens. Faster
    // shoot cadence + drop the charge telegraph so dodges become
    // pure reaction. One-time summon of 2 healers at the boss
    // position so killing those becomes the new prerequisite to
    // safely chip the last quarter HP.
    e.phase = 4;
    e.enraged = true;
    if (e.shootCooldown) e.shootCooldown = 1.2;
    const baseHealer = ENEMY_TYPES.find(t => t.name === 'healer');
    if (baseHealer) {
      for (let s = 0; s < 2; s++) {
        const sa = g.rng.random() * Math.PI * 2;
        const sr = 50 + g.rng.random() * 30;
        const minion = scaleEnemy(baseHealer, g.wave, g.rng);
        minion.x = e.x + Math.cos(sa) * sr;
        minion.y = e.y + Math.sin(sa) * sr;
        g.enemies.push(minion);
      }
    }
    emit(g, EVT.BOSS_PHASE, { phase: 4, x: e.x, y: e.y });
  } else if (hpPct <= 1 / 3 && e.phase < 3) {
    e.phase = 3;
    // +30% from phase 2, then another +20% = ×1.56 total vs baseSpeed
    e.speed = e.baseSpeed * 1.56;
    e.homing = true;
    e.summonTimer = 0; // fire first pulse immediately
    // Drop shoot cooldown in case boss enters phase 3 directly
    if (e.shootCooldown) e.shootCooldown = 2.0;
    emit(g, EVT.BOSS_PHASE, { phase: 3, x: e.x, y: e.y });
  } else if (hpPct <= 2 / 3 && e.phase < 2) {
    e.phase = 2;
    e.speed = e.baseSpeed * 1.30;
    if (e.shootCooldown) e.shootCooldown = 2.0;
    emit(g, EVT.BOSS_PHASE, { phase: 2, x: e.x, y: e.y });
  }

  // Phase 3 summon pulse — 3 swarm minions every 8 s, runs during
  // both stalk and charge so the pressure never lets up.
  if (e.phase === 3) {
    e.summonTimer -= dt;
    if (e.summonTimer <= 0) {
      e.summonTimer = 8;
      const base = ENEMY_TYPES.find(t => t.name === 'swarm');
      for (let s = 0; s < 3; s++) {
        const sa = g.rng.random() * Math.PI * 2;
        const sr = 20 + g.rng.random() * 25;
        const minion = scaleEnemy(base, g.wave, g.rng);
        minion.x = e.x + Math.cos(sa) * sr;
        minion.y = e.y + Math.sin(sa) * sr;
        g.enemies.push(minion);
      }
    }
  }

  // --- Charge movement ---
  if (e.charging > 0) {
    e.x += e.chargeDx * e.speed * 3 * dt;
    e.y += e.chargeDy * e.speed * 3 * dt;
    e.charging -= dt;
    return;
  }
  // stalking
  e.x += (edx / dist) * e.speed * 0.5 * dt;
  e.y += (edy / dist) * e.speed * 0.5 * dt;
  e.chargeTimer -= dt;
  e.stepTimer -= dt;
  if (e.stepTimer <= 0 && dist < 500) {
    emit(g, EVT.BOSS_STEP, { x: e.x, y: e.y });
    e.stepTimer = 0.7 + g.rng.random() * 0.3;
  }
  if (e.chargeTimer <= 0 && dist < 400) {
    e.chargeDx = edx / dist;
    e.chargeDy = edy / dist;
    e.charging = 0.8;
    // Enrage compresses the gap between charges and skips the windup
    // telegraph — players can't pre-dodge, only react to the dash itself.
    if (e.enraged) {
      e.chargeTimer = 1.5 + g.rng.random() * 1.5;
    } else {
      e.chargeTimer = 4 + g.rng.random() * 3;
      emit(g, EVT.BOSS_TELEGRAPH, { x: e.x, y: e.y });
    }
  }
}

function updateGhostMovement(e, dt, edx, edy, dist, speedMod = 1) {
  const nx = edx / dist;
  const ny = edy / dist;
  const sign = e.orbitSign || 1;
  const perpX = -ny * sign;
  const perpY = nx * sign;
  // closing at range, committed up close, drive-by prevented at melee
  const inward = dist > 100 ? 0.8 : 1.0;
  const orbit = dist > 100 ? 0.6 : dist > 30 ? 0.3 : 0.1;
  e.x += (nx * inward + perpX * orbit) * e.speed * speedMod * dt;
  e.y += (ny * inward + perpY * orbit) * e.speed * speedMod * dt;
}

function updateSpawnerAi(g, e, dt) {
  e.spawnTimer -= dt;
  if (e.spawnTimer > 0) return;
  e.spawnTimer = 3 + g.rng.random() * 2;
  const count = 3 + Math.floor(g.rng.random() * 3); // 3-5 swarmlings
  // Wave 12+ a third of each brood comes out as poisoners instead of
  // swarm. Same per-minion roll so a single brood can be mixed; the
  // visual still reads as a swarm because most of the brood are still
  // swarm sprites, but kiting becomes mandatory because contact with
  // any of the teal ones stacks a 4s burn.
  const poisonerChance = g.wave >= 12 ? 0.33 : 0;
  const swarmBase = ENEMY_TYPES.find(t => t.name === 'swarm');
  const poisonBase = ENEMY_TYPES.find(t => t.name === 'poisoner');
  for (let s = 0; s < count; s++) {
    const sa = g.rng.random() * Math.PI * 2;
    const sr = 20 + g.rng.random() * 20;
    const usePoisoner = poisonerChance > 0 && g.rng.random() < poisonerChance;
    const base = usePoisoner && poisonBase ? poisonBase : swarmBase;
    const minion = scaleEnemy(base, g.wave, g.rng);
    minion.x = e.x + Math.cos(sa) * sr;
    minion.y = e.y + Math.sin(sa) * sr;
    g.enemies.push(minion);
  }
  emit(g, EVT.HIVE_BURST, { x: e.x, y: e.y });
}

// Healer pulse — every healInterval, restore healAmount HP to every
// enemy within healRadius (excluding self and dying enemies). Caps at
// each enemy's maxHp so it can't overheal. Reuses HIVE_BURST as the
// visual cue since clients already render it as a soft particle pop;
// the green color of the healer makes the burst read as healing
// without needing a new event type.
function updateHealerAi(g, e, dt) {
  e.healTimer -= dt;
  if (e.healTimer > 0) return;
  e.healTimer = e.healInterval;
  const r2 = e.healRadius * e.healRadius;
  let healed = 0;
  for (const other of g.enemies) {
    if (other === e || other.dying !== undefined) continue;
    const dx = other.x - e.x, dy = other.y - e.y;
    if (dx * dx + dy * dy > r2) continue;
    if (other.hp >= other.maxHp) continue;
    other.hp = Math.min(other.maxHp, other.hp + e.healAmount);
    healed++;
  }
  if (healed > 0) emit(g, EVT.HIVE_BURST, { x: e.x, y: e.y });
}

// Boids steering: separation + alignment + cohesion vs same-type
// neighbors inside this enemy's flock perception radius. Reads from the
// pre-built spatial hash so we touch only ~9 cells per enemy. Returns
// the unweighted forces — caller blends with chase + chaseWeight.
function computeFlockSteering(g, hash, ei) {
  const e = g.enemies[ei];
  const fc = e.flock;
  const cx = Math.floor(e.x / HASH_CELL);
  const cy = Math.floor(e.y / HASH_CELL);
  const perR2 = fc.perceptionRadius * fc.perceptionRadius;
  const sepR2 = fc.sepRadius * fc.sepRadius;
  let sepX = 0, sepY = 0;
  let alignX = 0, alignY = 0;
  let cohX = 0, cohY = 0;
  let neighborCount = 0;
  for (let kx = -1; kx <= 1; kx++) {
    for (let ky = -1; ky <= 1; ky++) {
      const bucket = hash.get((cx + kx) * HASH_KEY_STRIDE + (cy + ky));
      if (!bucket) continue;
      for (let bi = 0; bi < bucket.length; bi++) {
        const j = bucket[bi];
        if (j === ei) continue;
        const o = g.enemies[j];
        if (o.name !== e.name || o.dying !== undefined) continue;
        const dx = e.x - o.x, dy = e.y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > perR2 || d2 < 0.01) continue;
        if (d2 < sepR2) {
          // Inverse-distance separation — enemies that are nearly
          // touching push MUCH harder than ones at the edge of the
          // separation radius. Prevents the flat-force clumping where
          // distant and close neighbors contributed equally.
          const d = Math.sqrt(d2);
          const strength = (fc.sepRadius - d) / fc.sepRadius;
          sepX += (dx / d) * strength;
          sepY += (dy / d) * strength;
        }
        alignX += o.vx;
        alignY += o.vy;
        cohX += o.x - e.x;
        cohY += o.y - e.y;
        neighborCount++;
      }
    }
  }
  if (neighborCount > 0) {
    alignX /= neighborCount; alignY /= neighborCount;
    cohX /= neighborCount;   cohY /= neighborCount;
  }
  return { sepX, sepY, alignX, alignY, cohX, cohY };
}

// Per-enemy movement + AI + hit-flash decay + player contact. Movement
// + AI target the nearest alive player; contact damage hits any player
// the enemy actually overlaps. Dying enemies were removed in the
// pre-pass, so indices stay stable for the flock hash here.
function updateEnemyTick(g, dt, hash) {
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i];
    if (e.dying !== undefined) continue; // animating but not interacting

    // Status effects: drain durations, apply burn DoT, compute speed
    // multiplier. Resist (boss 0.5 / elite 0.5 / spawner 0.3) shortens
    // incoming durations at apply-time, not here. Freeze reuses the
    // stunTimer gate so spawner-birth and shooting are also suppressed
    // (matches thunder_god overcharge behavior).
    let speedMod = 1;
    if (e.statusEffects?.length) {
      e.statusEffects = e.statusEffects.filter(s => {
        s.remaining -= dt;
        if (s.type === 'burn') {
          s.tickAccum = (s.tickAccum || 0) + dt;
          // Drain accumulated time in full tick increments so fast dt
          // values don't skip a tick.
          while (s.tickAccum >= s.tickRate && !e.dying) {
            damageEnemy(g, e, s.magnitude, null);
            s.tickAccum -= s.tickRate;
          }
        } else if (s.type === 'slow') {
          speedMod = Math.min(speedMod, s.magnitude);
        } else if (s.type === 'freeze') {
          speedMod = 0;
        }
        if (s.remaining <= 0) {
          emit(g, EVT.STATUS_EXPIRED, { statusType: s.type, x: e.x, y: e.y });
          return false;
        }
        return true;
      });
      // Freeze: bump stunTimer by one frame so the existing gate
      // blocks movement/spawner/shooting this tick without touching
      // the stun decrement logic that runs inside the guard.
      if (speedMod === 0) e.stunTimer = Math.max(e.stunTimer || 0, dt + 0.001);
    }

    // Stunned enemies freeze in place but still take damage. Thunder god
    // overcharge is the current source; freeze status extends this gate.
    if (e.stunTimer > 0) {
      e.stunTimer -= dt;
    } else {
      const target = nearestAlivePlayer(g, e.x, e.y);
      if (target && target.dist > 1) {
        if (e.name === 'ghost')      updateGhostMovement(e, dt, target.dx, target.dy, target.dist, speedMod);
        else if (e.name === 'boss')  updateBossAi(g, e, dt, target.dx, target.dy, target.dist);
        else if (!e.flock) {
          // Fallback for any type without flock config — pure chase.
          e.x += (target.dx / target.dist) * e.speed * speedMod * dt;
          e.y += (target.dy / target.dist) * e.speed * speedMod * dt;
        } else {
          // Boids blend: chase + separation + alignment + cohesion +
          // obstacle avoidance. Avoidance has a high implicit weight
          // because its raw vector is summed inverse-distance — close
          // walls dominate the steering, distant ones nudge softly.
          const fc = e.flock;
          const chaseX = target.dx / target.dist;
          const chaseY = target.dy / target.dist;
          const f = computeFlockSteering(g, hash, i);
          // Lookahead distance scales with speed so fast enemies see
          // further ahead and have room to steer. At 60u/s (blob) this
          // gives ~60u lookahead; at 130u/s (fast) ~110u — enough to
          // turn around corners instead of overshooting.
          const avoid = g.obstacles && g.obstacles.length > 0
            ? obstacleAvoidance(e.x, e.y, e.vx, e.vy, g.obstacles, e.radius + e.speed * 0.8)
            : ZERO_VEC;
          let vx = chaseX * fc.chaseWeight
                 + f.sepX * fc.sepWeight
                 + f.alignX * fc.alignWeight
                 + f.cohX * fc.cohWeight
                 + avoid.x * 5.0;
          let vy = chaseY * fc.chaseWeight
                 + f.sepY * fc.sepWeight
                 + f.alignY * fc.alignWeight
                 + f.cohY * fc.cohWeight
                 + avoid.y * 5.0;
          const m = Math.hypot(vx, vy);
          if (m > 0.001) {
            e.vx = (vx / m) * e.speed * speedMod;
            e.vy = (vy / m) * e.speed * speedMod;
          } else {
            // Forces canceled exactly — fall back to chase so the enemy
            // doesn't freeze in place.
            e.vx = chaseX * e.speed * speedMod;
            e.vy = chaseY * e.speed * speedMod;
          }
          e.x += e.vx * dt;
          e.y += e.vy * dt;
        }
      }
    }

    // Push enemies out of obstacles — naturally creates "pathfinding"
    // as they slide along walls toward the target.
    if (g.obstacles && g.obstacles.length > 0) pushOutOfObstacles(e, g.obstacles);

    // Spawner births minions on a timer — gated by stun so a stunned
    // hive doesn't keep pumping out swarmlings during the freeze.
    if (e.name === 'spawner' && (!e.stunTimer || e.stunTimer <= 0)) updateSpawnerAi(g, e, dt);
    // Healer pulses HP back into nearby enemies — same stun gate so
    // freeze/stun stalls support behavior, not just damage.
    if (e.name === 'healer' && (!e.stunTimer || e.stunTimer <= 0)) updateHealerAi(g, e, dt);

    // Ranged attacks — elites fire aimed shots, bosses fire spreads.
    // Uses its own nearest-player lookup because the movement target
    // is scoped inside the stun guard above.
    if (e.shootCooldown && (!e.stunTimer || e.stunTimer <= 0)) {
      const shootTarget = nearestAlivePlayer(g, e.x, e.y);
      enemyShootingAi(g, e, dt, shootTarget);
    }

    if (e.hitFlash > 0) e.hitFlash -= dt * 5;

    // Contact damage — hit every overlapping alive player (not just nearest).
    for (const p of g.players) {
      if (!p.alive || p.iframes > 0) continue;
      const dx = p.x - e.x, dy = p.y - e.y;
      if (dx * dx + dy * dy < (p.radius + e.radius) ** 2) {
        const dmg = Math.max(1, e.damage - (p.armor || 0));
        p.hp -= dmg;
        p.iframes = 0.5;
        emit(g, EVT.PLAYER_HIT, { x: p.x, y: p.y, dmg, by: e.name, pid: p.id });
        // Poisoner DoT — ignores iframes (status applies even when the
        // hit is i-framed, since the player still touched the source).
        if (e.poisonOnHit) {
          applyPoisonToPlayer(p, e.poisonOnHit.dps, e.poisonOnHit.duration);
        }
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          emit(g, EVT.PLAYER_DEATH, { x: p.x, y: p.y, by: e.name, pid: p.id });
        }
      }
    }
  }
}

// Pass 2: hard overlap correction. Per-type separation in the flock pass
// already keeps enemies spaced at preferred distances; this pass only
// fires when sprites actually overlap (sum-of-radii) to prevent visual
// stacking. Builds its own hash post-movement.
function updateRepulsion(g) {
  const hash = buildSpatialHash(g.enemies);
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    const cx = Math.floor(e.x / HASH_CELL);
    const cy = Math.floor(e.y / HASH_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = hash.get((cx + dx) * HASH_KEY_STRIDE + (cy + dy));
        if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const j = bucket[bi];
          if (j <= i) continue; // each pair handled once
          const e2 = g.enemies[j];
          const rx = e.x - e2.x;
          const ry = e.y - e2.y;
          const rd = Math.sqrt(rx * rx + ry * ry);
          const minD = e.radius + e2.radius;
          if (rd < minD && rd > 0.1) {
            const push = (minD - rd) * 0.5;
            const nx = rx / rd;
            const ny = ry / rd;
            e.x += nx * push;
            e.y += ny * push;
            e2.x -= nx * push;
            e2.y -= ny * push;
          }
        }
      }
    }
  }
}

export function updateEnemies(g, dt) {
  // Pre-pass: progress death animations + remove finished ones BEFORE
  // building the hash so the flock pass sees stable indices (no
  // mid-tick splices invalidating the bucket index lists).
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i];
    if (e.dying === undefined) continue;
    e.dying -= dt;
    if (e.dying <= 0) g.enemies.splice(i, 1);
  }
  const hash = buildSpatialHash(g.enemies);
  updateEnemyTick(g, dt, hash);
  updateRepulsion(g);
  // Final push-out pass: enemy-vs-enemy repulsion can shove neighbors
  // sideways into walls, so we re-correct after. Without this an enemy
  // packed against a wall by its flockmates ends each tick stuck
  // inside the obstacle.
  if (g.obstacles && g.obstacles.length > 0) {
    for (const e of g.enemies) {
      if (e.dying === undefined) pushOutOfObstacles(e, g.obstacles);
    }
  }
}
