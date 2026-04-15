// View shape — the contract between sim state and the renderer.
//
// Both SP and MP eventually pump frames through the same render
// pipeline. The renderer consumes a `View` object whose shape matches
// what the MP server already snapshots; SP synthesizes the same shape
// from its in-process `g`.
//
// Renderer treats the view as read-only. It MUST NOT mutate fields,
// because in MP the snapshot is shared across all clients and in SP
// `synthesizeView` returns shallow refs into the live sim.
//
// This module is the home for that contract. As individual render
// blocks get extracted (per the SP/MP unification roadmap) they'll
// move from main.js / mp-main.js into shared/render.js and read from
// the View instead of the live `g` or `state`. PR 1 lays the
// foundation; subsequent PRs migrate one block at a time.

/**
 * @typedef {object} View
 * @property {number} time
 * @property {number} wave
 * @property {number} kills
 * @property {object} arena       — { w, h }
 * @property {string} mapId
 * @property {Array}  players     — { id, name, color, x, y, hp, maxHp,
 *                                    alive, level, kills, xp, xpToLevel,
 *                                    weapons[], activeSkin, activeTrail }
 * @property {Array}  enemies     — { name, x, y, hp, maxHp, radius,
 *                                    color, hitFlash, dying? }
 * @property {Array}  projectiles — { x, y, radius, color, owner, vx?, vy? }
 * @property {Array}  gems        — { x, y, xp, radius? }
 * @property {Array}  heartDrops  — { x, y, heal, radius, life, bobPhase }
 * @property {Array}  chainEffects  — { points: [{x,y}], life, color }
 * @property {Array}  meteorEffects — { x, y, radius, life, phase, color }
 * @property {Array}  consumables — { x, y, type, radius, color, life, bobPhase }
 * @property {Array}  obstacles   — { x, y, w, h, type }
 */

// Synthesize a View from an in-process sim state `g` (SP). Cheap —
// shallow refs / arrays are reused; mutations to the returned view
// would mutate the live sim, so callers must treat it read-only.
//
// Currently unused by callers — wired in incremental PRs as render
// blocks migrate to read from the view instead of `g` directly.
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
    chainEffects: g.chainEffects,
    meteorEffects: g.meteorEffects,
    obstacles: g.obstacles,
  };
}
