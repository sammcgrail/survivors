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
      };
    }
  } catch (_) { /* corrupt data — reset */ }
  return { scales: 0, totalEarned: 0, unlocks: {}, milestones: {} };
}

export function savePrestige(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) { /* storage full — silently fail */ }
}

/** Apply all owned unlocks to a player object at run start. */
export function applyPrestigeUnlocks(player) {
  const prestige = loadPrestige();
  for (const u of UNLOCKS) {
    const n = prestige.unlocks[u.id] || 0;
    if (n > 0) u.apply(player, n);
  }
}
