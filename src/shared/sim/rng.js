// Tiny seeded RNG. The simulation reads from this instead of Math.random
// so a server can replay ticks deterministically (and identical seeds on
// client + server let us catch desyncs in lockstep modes later).
//
// mulberry32 — small, fast, good enough for a game.
export function createRng(seed) {
  let s = (seed >>> 0) || 1;
  function next() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    random: next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    range: (lo, hi) => lo + next() * (hi - lo),
  };
}

