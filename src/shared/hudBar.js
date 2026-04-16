// Generic canvas bar renderer — HP, cooldown indicators, any 2-tone
// progress bar. Pure function, no state. Both SP and MP use `drawHpBar`
// from render.js, which delegates here; extract avoids future inline drift.
//
// pct — fill fraction, 0..1 (clamped to min 0)
// opts.bg  — background color (default '#222')
// opts.fg  — explicit foreground; if omitted, green above lowThreshold, red below
// opts.lowThreshold — threshold for auto-fg switch (default 0.3)

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x      — center-x of the bar
 * @param {number} y      — top-y of the bar
 * @param {number} w      — total width
 * @param {number} h      — height
 * @param {number} pct    — fill fraction (0..1)
 * @param {{ bg?: string, fg?: string, lowThreshold?: number }} [opts]
 */
export function drawBar(ctx, x, y, w, h, pct, opts = {}) {
  const { bg = '#222', fg = null, lowThreshold = 0.3 } = opts;
  const fill = fg ?? (pct > lowThreshold ? '#2ecc71' : '#e74c3c');
  ctx.fillStyle = bg;
  ctx.fillRect(x - w / 2, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, pct), h);
}
