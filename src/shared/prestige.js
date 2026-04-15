// Dragon Scales prestige system — meta-progression currency earned on death.
// Pure data/logic module — no DOM references. UI lives in main.js.

const STORAGE_KEY = 'survivors_prestige';

export const UNLOCKS = [
  // stat bonuses
  { id: 'tough_scales',  name: 'Tough Scales',  desc: '+10 max HP per stack',      icon: '\u{1F9E1}', cost: 5,  max: 5, cosmetic: false,
    apply: (p, n) => { p.maxHp += 10 * n; p.hp += 10 * n; } },
  { id: 'swift_wings',   name: 'Swift Wings',   desc: '+5% move speed per stack',  icon: '\u{1F985}', cost: 8,  max: 3, cosmetic: false,
    apply: (p, n) => { p.speed *= 1 + 0.05 * n; } },
  { id: 'keen_eyes',     name: 'Keen Eyes',      desc: '+10% XP magnet range per stack', icon: '\u{1F441}\uFE0F', cost: 6,  max: 3, cosmetic: false,
    apply: (p, n) => { p.magnetRange *= 1 + 0.1 * n; } },
  { id: 'thick_hide',    name: 'Thick Hide',     desc: '+0.5 HP regen per stack',   icon: '\u{1F6E1}\uFE0F', cost: 10, max: 3, cosmetic: false,
    apply: (p, n) => { p.hpRegen += 0.5 * n; } },
  { id: 'fury',          name: 'Fury',           desc: '+5% damage per stack',      icon: '\u{1F525}', cost: 12, max: 5, cosmetic: false,
    apply: (p, n) => { p.damageMulti *= 1 + 0.05 * n; } },
  { id: 'extra_heart',   name: 'Extra Heart',    desc: 'Start with +25 HP',         icon: '\u{2764}\uFE0F', cost: 15, max: 1, cosmetic: false,
    apply: (p, n) => { p.maxHp += 25 * n; p.hp += 25 * n; } },
  { id: 'headstart',     name: 'Headstart',      desc: 'Start at level 2',          icon: '\u{2B50}', cost: 20, max: 1, cosmetic: false,
    apply: (p, n) => { if (n > 0) p.level = 2; } },
  // cosmetics (apply is a no-op; rendering checks prestige data directly)
  { id: 'skin_gold',     name: 'Gold Dragon',    desc: 'Gold player skin',          icon: '\u{1F451}', cost: 25, max: 1, cosmetic: true,
    apply: () => {} },
  { id: 'skin_shadow',   name: 'Shadow Dragon',  desc: 'Shadow Dragon skin',        icon: '\u{1F311}', cost: 25, max: 1, cosmetic: true,
    apply: () => {} },
  { id: 'trail_fire',    name: 'Fire Trail',     desc: 'Fire trail particles',      icon: '\u{1F525}', cost: 15, max: 1, cosmetic: true,
    apply: () => {} },
];

/** Earn formula: floor(wave/2) + floor(kills/50) + evolutions. Minimum 1. */
export function calculateScales(run) {
  const wave    = run.wave || 0;
  const kills   = run.kills || 0;
  // Count evolution powerups owned (ids starting with 'evo_')
  const stacks  = run.powerupStacks || {};
  let evolutions = 0;
  for (const key in stacks) {
    if (key.startsWith('evo_') && stacks[key] > 0) evolutions += stacks[key];
  }
  return Math.max(1, Math.floor(wave / 2) + Math.floor(kills / 50) + evolutions);
}

export function loadPrestige() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        scales:      data.scales      || 0,
        totalEarned: data.totalEarned || 0,
        unlocks:     data.unlocks     || {},
        milestones:  data.milestones  || {},
        activeSkin:  data.activeSkin   || null,   // 'skin_gold' | 'skin_shadow' | null
        activeTrail: data.activeTrail  || null,   // 'trail_fire' | null
      };
    }
  } catch (_) { /* corrupt data — reset */ }
  return { scales: 0, totalEarned: 0, unlocks: {}, milestones: {}, activeSkin: null, activeTrail: null };
}

/** Toggle a cosmetic on/off. Returns the updated prestige data. */
export function toggleCosmetic(id) {
  const prestige = loadPrestige();
  if (!prestige.unlocks[id]) return prestige; // not owned
  if (id.startsWith('skin_')) {
    prestige.activeSkin = prestige.activeSkin === id ? null : id;
  } else if (id.startsWith('trail_')) {
    prestige.activeTrail = prestige.activeTrail === id ? null : id;
  }
  savePrestige(prestige);
  return prestige;
}

export function savePrestige(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) { /* storage full — silently fail */ }
}

// Clamp a raw {id: count} map to catalog max per id, dropping unknown
// ids. Shared by applyUnlocks + sanitizePrestige.
function clampUnlocks(raw) {
  const out = {};
  if (!raw) return out;
  for (const u of UNLOCKS) {
    const n = Math.max(0, Math.min(Number(raw[u.id]) || 0, u.max));
    if (n > 0) out[u.id] = n;
  }
  return out;
}

/** Apply an unlocks map (id -> count) to a player. Counts are clamped
 *  to catalog max so untrusted client input can't over-buff —
 *  server.mjs calls this on join with whatever the client sent. */
export function applyUnlocks(player, unlocks) {
  const clamped = clampUnlocks(unlocks);
  for (const u of UNLOCKS) {
    const n = clamped[u.id] || 0;
    if (n > 0) u.apply(player, n);
  }
}

/** SP convenience: pull from localStorage and apply. */
export function applyPrestigeUnlocks(player) {
  applyUnlocks(player, loadPrestige().unlocks);
}

/** Validate + sanitize a client-supplied prestige payload. Returns
 *  `{ unlocks, activeSkin, activeTrail }` with each unlock count
 *  capped, unknown keys stripped, and cosmetics required to be owned.
 *  Used by server.mjs so peer validation lives in one place. */
export function sanitizePrestige(raw) {
  const out = { unlocks: {}, activeSkin: null, activeTrail: null };
  if (!raw || typeof raw !== 'object') return out;
  out.unlocks = clampUnlocks(raw.unlocks);
  // Cosmetics must be in the catalog, marked cosmetic, and actually
  // owned (count > 0). Catalog id-prefix decides skin vs trail.
  const cosmetic = (id, prefix) => {
    if (!id || !id.startsWith(prefix)) return null;
    const u = UNLOCKS.find(x => x.id === id && x.cosmetic);
    if (!u) return null;
    return (out.unlocks[id] || 0) > 0 ? id : null;
  };
  out.activeSkin = cosmetic(raw.activeSkin, 'skin_');
  out.activeTrail = cosmetic(raw.activeTrail, 'trail_');
  return out;
}
