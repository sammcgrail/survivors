// Bestiary — tracks which enemies a player has encountered across
// sessions. Data + storage only (DOM lives in main.js / mp-main.js).
// SP + MP both call markSeen() from their render loop on every enemy
// they render; first sight records name + first wave to localStorage.

import { ENEMY_TYPES } from './enemyTypes.js';

const SEEN_KEY = 'bestiary_seen';

// One flavor line per enemy. Kept short — the card UI is tight.
export const BESTIARY_INFO = {
  blob:    { display: 'Blob',       desc: 'Slow-moving horde fodder. Shows up in packs from wave 1.' },
  fast:    { display: 'Dasher',     desc: 'Low HP, high speed. Flanks from angles — easy to AoE, hard to dodge.' },
  tank:    { display: 'Brute Tank', desc: 'Heavy armour, slow approach. Absorbs damage meant for the squishies behind it.' },
  swarm:   { display: 'Swarmling',  desc: 'Tiny, fragile, arrives in swirling packs. Deadly only in numbers.' },
  brute:   { display: 'Wrecker',    desc: 'Lone charger. Ignores the group, paths straight at you.' },
  ghost:   { display: 'Phantom',    desc: 'Orbits the player at range, closes in bursts. Phases through flock pressure.' },
  elite:   { display: 'Elite',      desc: 'Tactical squads. High HP and damage — appearing past wave 17 is a bad sign.' },
  spawner: { display: 'Hive',       desc: 'Drifts slowly. Periodically births 3-5 swarmlings. Kill it or drown.' },
  boss:    { display: 'The Demon',  desc: 'Wave 20 boss. Stalks, then charges. Telegraph flashes before it commits.' },
};

// localStorage throws in some contexts (private browsing, disabled
// storage). Wrap access so the bestiary silently degrades to in-memory
// only rather than breaking the game.
function readSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) { return {}; }
}

function writeSeen(map) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch (_) {}
}

// Map of name -> first-seen wave. Loaded once per session and
// cached; writes go through writeSeen so multiple tabs don't
// desync (last write wins is fine for this feature).
let cache = null;
function ensureLoaded() { if (cache === null) cache = readSeen(); }

export function getSeen() {
  ensureLoaded();
  return cache;
}

// Called from the render loop on every enemy in view. Idempotent —
// only writes to localStorage the first time a name appears.
export function markSeen(name, wave) {
  if (!BESTIARY_INFO[name]) return;           // unknown type — skip
  ensureLoaded();
  if (cache[name] !== undefined) return;      // already seen
  cache[name] = wave | 0;
  writeSeen(cache);
}

// Ordered list of {name, info, baseStats, firstWave | null}. Caller
// renders cards (or silhouettes for undiscovered entries).
export function getBestiaryEntries() {
  ensureLoaded();
  return ENEMY_TYPES.map(t => ({
    name: t.name,
    info: BESTIARY_INFO[t.name],
    baseStats: { hp: t.hp, speed: t.speed, damage: t.damage },
    color: t.color,
    sprite: t.sprite,
    firstWave: cache[t.name] === undefined ? null : cache[t.name],
  }));
}
