// Achievement definitions and localStorage-backed unlock logic.
// Pure module — no game-state imports, safe to use from SP and MP.

export const ACHIEVEMENTS = [
  { id: 'first_blood',   label: 'First Blood',    icon: '🩸', desc: 'Kill your first enemy' },
  { id: 'boss_slayer',   label: 'Boss Slayer',     icon: '☠️',  desc: 'Kill the boss' },
  { id: 'evolved',       label: 'Evolved',         icon: '✦',  desc: 'Unlock an evolution weapon' },
  { id: 'wave_10',       label: 'Wave Rider',      icon: '🌊', desc: 'Reach wave 10' },
  { id: 'wave_20',       label: 'The Final Wave',  icon: '💀', desc: 'Reach wave 20' },
  { id: 'kills_100',     label: 'Century',         icon: '💯', desc: 'Get 100 kills in one run' },
  { id: 'kills_1000',    label: 'Exterminator',    icon: '🔥', desc: 'Get 1000 kills in one run' },
  { id: 'full_loadout',  label: 'Arsenal',         icon: '⚔️',  desc: 'Hold 4 or more weapons at once' },
  { id: 'level_10',      label: 'Seasoned',        icon: '⭐', desc: 'Reach level 10' },
  { id: 'survivor_5min', label: 'Survivor',        icon: '⏱️',  desc: 'Survive 5 minutes' },
];

/** Load unlocked map { [id]: timestamp } from localStorage. */
export function loadAchievements() {
  try {
    return JSON.parse(localStorage.getItem('achievements') || '{}');
  } catch {
    return {};
  }
}

/** Persist the unlocked map to localStorage. */
export function saveAchievements(unlocked) {
  localStorage.setItem('achievements', JSON.stringify(unlocked));
}

/**
 * Grant an achievement if not already held.
 * Mutates `unlocked` in-place and persists.
 * Returns true if this is a new unlock, false if already owned.
 */
export function grantAchievement(unlocked, id) {
  if (unlocked[id]) return false;
  unlocked[id] = Date.now();
  saveAchievements(unlocked);
  return true;
}
