// View shape — the contract between sim state and the renderer.
//
// Both SP and MP pump frames through the same render pipeline. The
// renderer consumes a `View` object whose shape matches what the MP
// server snapshots; SP synthesizes the same shape from its in-process
// `g` via synthesizeView() and passes the result to renderWorld().
//
// Renderer treats the view as read-only. It MUST NOT mutate fields,
// because in MP the snapshot is shared across all clients and in SP
// synthesizeView returns shallow refs into the live sim. (One
// documented carve-out: drawProjectiles spawns ember particles into
// a separate caller-owned array — see the comment at that call site.)
//
// `?` after a field name means "optional / may be absent" — the
// renderer falls back gracefully. The server omits these to save
// snapshot bytes when the field is at its default; the renderer
// branches accordingly.

/**
 * @typedef {object} View
 * @property {number} time
 * @property {number} wave
 * @property {number} kills
 * @property {object} arena       — { w, h }
 * @property {string} mapId
 * @property {Array}  players     — { id, name, color, x, y, hp, maxHp,
 *                                    alive, level, kills, xp, xpToLevel,
 *                                    weapons[], activeSkin, activeTrail,
 *                                    sizeMulti?, projectileBonus?,
 *                                    facing?: {x,y}, iframes? }
 * @property {Array}  enemies     — { name, x, y, hp, maxHp, radius,
 *                                    color, hitFlash?, dying? }
 * @property {Array}  projectiles — { x, y, radius, owner, color, vx, vy }
 * @property {Array}  gems        — { x, y } — radius defaults to 6,
 *                                    xp ships on GEM_PICKUP event only
 * @property {Array}  heartDrops  — { x, y, radius, life, bobPhase } —
 *                                    healed amount ships on HEART_PICKUP
 * @property {Array}  chainEffects  — { points: [{x,y}], life, color }
 * @property {Array}  meteorEffects — { x, y, radius, life, phase, color }
 * @property {Array}  consumables — { x, y, type, radius, color, bobPhase }
 *                                    — never despawn (no life field)
 * @property {Array}  chargeTrails — { x, y, radius, life, color }
 * @property {Array}  enemyProjectiles — { x, y, vx, vy, radius, color, source }
 * @property {Array}  obstacles   — { x, y, w, h, type }
 * @property {Array}  events?     — transient sim events drained by
 *                                    applySimEvent (sfx/particles/text)
 *
 * weapons[] entries — see snapshotWeapon in server.mjs for the full
 * field list. Includes the per-type animation state (phase/pulsePhase/
 * fireCount/active), charge-dash fields when active (chargeDx/Dy/
 * speed/duration/chargeTimer/width), and cooldown timer/cooldown
 * for charge + fortress while recharging.
 */

// Synthesize a View from an in-process sim state `g` (SP). Cheap —
// shallow refs / arrays are reused; mutations to the returned view
// would mutate the live sim, so callers must treat it read-only.
export function synthesizeView(g) {
  return {
    time: g.time,
    wave: g.wave,
    kills: g.kills,
    arena: g.arena,
    mapId: g.mapId,
    players: g.players,
    enemies: g.enemies,
    projectiles: g.projectiles,
    gems: g.gems,
    heartDrops: g.heartDrops,
    consumables: g.consumables,
    chests: g.chests,
    chargeTrails: g.chargeTrails,
    enemyProjectiles: g.enemyProjectiles,
    chainEffects: g.chainEffects,
    meteorEffects: g.meteorEffects,
    obstacles: g.obstacles,
    // SP drains g.events inline through applySimEvent before this
    // view is built; including the array on the view lets future
    // shared consumers read either source uniformly.
    events: g.events,
  };
}
