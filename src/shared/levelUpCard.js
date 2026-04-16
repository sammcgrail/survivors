// Shared decoration for the level-up choice card. SP + MP both render
// the same HTML shape; this keeps the weapon preview rendering (role
// chip + evo source icons) in one place so tuning the layout doesn't
// drift between modes.
//
// DOM-dependent, so it lives outside shared/sim/ (which is pure).
import { WEAPON_ICONS, getWeaponPreview, powerupWeaponType } from './weapons.js';

// Adds a role chip below the name, and if the choice is an evolution,
// appends "· 🔮 + 🌀" source-pair icons onto the existing evo badge.
// No-op for stat-buff entries. Returns the derived preview (or null)
// so the caller can pull stats for the card footer without re-deriving.
export function decorateWeaponCard(div, choice) {
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
    if (badge) badge.textContent = `✦ EVOLUTION · ${WEAPON_ICONS[a] || '?'} + ${WEAPON_ICONS[b] || '?'}`;
  }
  return preview;
}
