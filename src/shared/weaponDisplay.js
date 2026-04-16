// Standalone weapon display formatters — used by the level-up card,
// death highlights, and any future HUD that shows weapon stats.
// Extracted so SP and MP format identically without each inlining their own.
//
// Pure functions — no imports, no DOM, safe to import from anywhere.

/**
 * Returns a display string for weapon cooldown suitable for a stat line.
 * Examples: "1.8s cd", "0.5s pulse", "passive"
 * Returns empty string when the weapon has no meaningful cooldown (cooldown=0).
 * @param {{ cooldown: number, pulseCooldown?: number }} weapon
 * @returns {string}
 */
export function formatWeaponCooldown(weapon) {
  if (weapon.pulseCooldown)    return `${weapon.pulseCooldown}s pulse`;
  if (weapon.cooldown >= 9999) return 'passive';
  if (weapon.cooldown > 0)     return `${weapon.cooldown.toFixed(1)}s cd`;
  return '';
}

/**
 * Converts a weapon or powerup ID to a human-readable display name.
 *   "evo_dragon_storm" → "Dragon Storm"
 *   "weapon_spit"      → "Spit"
 *   "lightning_field"  → "Lightning Field"
 *   "spit"             → "Spit"
 * @param {string} id
 * @returns {string}
 */
export function formatWeaponName(id) {
  const type = id.startsWith('evo_')    ? id.slice(4)
             : id.startsWith('weapon_') ? id.slice(7)
             : id;
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
