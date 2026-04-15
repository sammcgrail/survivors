// Run history — persists the last MAX_RUNS death stats in localStorage.
const KEY = 'survivors_run_history';
const MAX_RUNS = 5;

/**
 * @returns {Array<{wave:number, kills:number, level:number, time:number, weapons:string[], ts:number}>}
 */
export function loadRunHistory() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

/**
 * Prepend the current run, trim to MAX_RUNS, persist, and return the updated list.
 * @param {object} game — live game object at death time
 * @returns {Array} updated history (current run is index 0)
 */
export function saveRunEntry(game) {
  const history = loadRunHistory();
  history.unshift({
    wave: game.wave,
    kills: game.kills,
    level: game.player.level,
    time: game.time,        // seconds
    weapons: game.player.weapons.map(w => w.type),
    ts: Date.now(),
  });
  if (history.length > MAX_RUNS) history.length = MAX_RUNS;
  try { localStorage.setItem(KEY, JSON.stringify(history)); } catch {}
  return history;
}
