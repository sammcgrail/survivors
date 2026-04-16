// Death feed renderer — fading bottom-left event log.
// Extracted from SP (src/main.js) and MP (src/mp-main.js); logic was
// identical modulo minor style differences (normalised here).

const FEED_MAX = 5;
const FEED_DURATION = 6; // seconds visible
const FADE_START = 5;    // begin fading at 5s, fully gone at 6s

/**
 * Render the death feed overlay (bottom-left, HUD space).
 * Does not assume any canvas transform — call after resetting to screen coords.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{text: string, time: number}>} feed  — g.deathFeed / state.deathFeed
 * @param {number} now    — current game time in seconds (g.time / state.time)
 * @param {number} H      — canvas pixel height
 */
export function renderDeathFeed(ctx, feed, now, H) {
  const recent = feed.slice(-FEED_MAX);
  for (let i = 0; i < recent.length; i++) {
    const entry = recent[i];
    const age = now - entry.time;
    if (age > FEED_DURATION) continue;
    const alpha = age > FADE_START ? (FEED_DURATION - age) : 1;
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.fillStyle = '#ccc';
    ctx.font = '10px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(entry.text, 12, H - 20 - (recent.length - 1 - i) * 16);
    ctx.restore();
  }
}
