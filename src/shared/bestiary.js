// Bestiary — tracks which enemies a player has encountered across
// sessions. Data + storage only (DOM lives in bestiaryUI.js).
// SP + MP both call markSeen() from their render loop on every enemy
// they render; records first-seen wave, times encountered, and last
// seen wave to localStorage.
//
// Schema (per enemy key in localStorage):
//   { seen: true, firstWave: N, timesEncountered: N, lastSeenWave: N }
// Migration: old { [name]: waveNumber } or { [name]: true } values are
// promoted to the new shape on first read.

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
function migrate(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'boolean') {
    // very old format: { [name]: true }
    return { seen: true, firstWave: null, timesEncountered: 1, lastSeenWave: null };
  }
  if (typeof v === 'number') {
    // previous format: { [name]: waveNumber }
    return { seen: true, firstWave: v, timesEncountered: 1, lastSeenWave: v };
  }
  // already new format
  return v;
}

function readSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = migrate(v);
    }
    return out;
  } catch (_) { return {}; }
}

function writeSeen(map) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch (_) {}
}

// Map of name -> entry object. Loaded once per session and cached;
// writes go through writeSeen so multiple tabs don't desync
// (last write wins is fine for this feature).
let cache = null;
function ensureLoaded() { if (cache === null) cache = readSeen(); }

export function getSeen() {
  ensureLoaded();
  return cache;
}

// Called from the render loop on every visible non-dying enemy.
// Deduped by wave: increments timesEncountered once per wave this
// enemy type is seen (not once per frame or enemy instance).
export function markSeen(name, wave) {
  if (!BESTIARY_INFO[name]) return;           // unknown type — skip
  ensureLoaded();
  const w = wave | 0;
  const existing = cache[name];
  if (existing === undefined) {
    // First ever encounter
    cache[name] = { seen: true, firstWave: w, timesEncountered: 1, lastSeenWave: w };
    writeSeen(cache);
    return;
  }
  // Already known — increment once per wave (guard against per-frame spam)
  if (existing.lastSeenWave === w) return;
  existing.timesEncountered++;
  existing.lastSeenWave = w;
  writeSeen(cache);
}

// Test helper — resets the in-memory cache so unit tests can start clean.
// NOT imported or called in production code.
export function _resetCache() { cache = null; }

// Ordered list of {name, info, baseStats, firstWave, timesEncountered,
// lastSeenWave}. firstWave / timesEncountered / lastSeenWave are null
// for undiscovered entries.
export function getBestiaryEntries() {
  ensureLoaded();
  return ENEMY_TYPES.map(t => {
    const e = cache[t.name];
    return {
      name: t.name,
      info: BESTIARY_INFO[t.name],
      baseStats: { hp: t.hp, speed: t.speed, damage: t.damage },
      color: t.color,
      sprite: t.sprite,
      firstWave:        e ? (e.firstWave        ?? null) : null,
      timesEncountered: e ? (e.timesEncountered  ?? 0)   : 0,
      lastSeenWave:     e ? (e.lastSeenWave      ?? null) : null,
    };
  });
}
