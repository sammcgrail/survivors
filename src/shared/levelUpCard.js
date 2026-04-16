// Shared decoration for the level-up choice card. SP + MP both render
// the same HTML shape; this keeps the weapon preview rendering (role
// chip + evo source icons) in one place so tuning the layout doesn't
// drift between modes.
//
// DOM-dependent, so it lives outside shared/sim/ (which is pure).
import { WEAPON_ICONS, WEAPON_EVO_SOURCES, getWeaponPreview, powerupWeaponType } from './weapons.js';

// Pure predicate — true when the player's current weapon loadout contains
// both source weapons required to trigger `evoWeaponType`.
// `loadout` is an array of weapon objects with a `.type` field (or any
// iterable of { type: string }). Returns false when evoWeaponType has
// no entry in WEAPON_EVO_SOURCES (i.e. is not an evolution).
//
// Both SP and MP call decorateWeaponCard; callers can pass loadout here
// so the evo-badge glow is consistent instead of each client inlining
// the same two-source intersection check.
export function isEvoReady(loadout, evoWeaponType) {
  const sources = WEAPON_EVO_SOURCES[evoWeaponType];
  if (!sources) return false;
  const [a, b] = sources;
  return loadout.some(w => w.type === a) && loadout.some(w => w.type === b);
}

// Adds a role chip below the name, and if the choice is an evolution,
// appends "· 🔮 + 🌀" source-pair icons onto the existing evo badge.
// When loadout is provided, adds 'choice-evo-badge--ready' class to the
// badge if the player already holds both source weapons.
// No-op for stat-buff entries. Returns the derived preview (or null)
// so the caller can pull stats for the card footer without re-deriving.
export function decorateWeaponCard(div, choice, loadout = null) {
  const wt = powerupWeaponType(choice.id);
  if (!wt) return null;
  const preview = getWeaponPreview(wt);
  if (!preview) return null;
  const role = document.createElement('div');
  role.className = 'choice-role';
  role.textContent = preview.role;
  const nameEl = div.querySelector('.name');
  if (nameEl) nameEl.insertAdjacentElement('afterend', role);
  else div.prepend(role);
  if (preview.evoSources) {
    const badge = div.querySelector('.choice-evo-badge');
    const [a, b] = preview.evoSources;
    if (badge) {
      badge.textContent = `✦ EVOLUTION · ${WEAPON_ICONS[a] || '?'} + ${WEAPON_ICONS[b] || '?'}`;
      // Mark the badge when both source weapons are already in the loadout —
      // lets players spot which evos they're one upgrade away from.
      if (loadout && isEvoReady(loadout, wt)) {
        badge.classList.add('choice-evo-badge--ready');
      }
    }
  }
  return preview;
}
