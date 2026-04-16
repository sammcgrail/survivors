// Shared base client-state factory. Both SP (main.js) and MP (mp-main.js)
// maintain particles, floating text, screen-shake, level-flash, and a
// sim-event queue.  SP owns them inside the game object returned by
// initGame(); MP owns them as module-level variables.
//
// Centralising the initial shape here means neither mode can silently
// drift to a different zero value (e.g. screenShake defaulting to
// undefined vs 0) and future fields can be added in one place.

/**
 * Returns the zero-state for client-side visual + event bookkeeping.
 * SP spreads this into initGame()'s return object.
 * MP destructures it to initialize its module-level variables.
 *
 * @returns {{
 *   particles: Array,
 *   floatingTexts: Array,
 *   events: Array,
 *   screenShake: number,
 *   levelFlash: number,
 * }}
 */
export function createBaseGameState() {
  return {
    particles: [],
    floatingTexts: [],
    events: [],        // sim-event queue drained each frame by applySimEvent
    screenShake: 0,    // decays each frame; raised by shake() in event clients
    levelFlash: 0,     // decays each frame; raised by flash() in event clients
  };
}
