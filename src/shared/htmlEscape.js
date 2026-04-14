// Minimal HTML escape — applied to any server-supplied string before
// being placed into innerHTML. The leaderboard and the MP level-up
// overlay both inject server data; sharing the escape closes both
// XSS surfaces at one place.
const REPL = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => REPL[c]);
}
