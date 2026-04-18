// Shared weapon-picker state + keyboard binding.
//
// Both SP (`src/main.js`) and MP (`src/mp-main.js`) kept an identical
// `let selectedWeapon = 'spit'` + `selectWeapon(type)` pair plus a
// `keydown` case that mapped '1' → spit, '2' → breath, '3' → charge.
//
// This module owns that state + the keyboard key-to-type map. Both
// entries consume the returned picker; SP additionally wires
// `onSelect: startMenuMusic` so any click/keypress on the start screen
// unlocks the audio context. MP doesn't need that — its audio context
// is unlocked via the PLAY button flow.
//
// Per `docs/BOOTSTRAP-UNIFICATION.md`, the SP↔MP variation is
// captured by parameter shape (`onSelect`), not `if (isMP)` branching.

const WEAPON_KEYS = { '1': 'spit', '2': 'breath', '3': 'charge' };

/**
 * Create a weapon-picker controller.
 *
 * @param {Object} [opts]
 * @param {string} [opts.initial='spit']  Default selected weapon type.
 * @param {(type: string) => void} [opts.onSelect]  Called after every
 *   selection. SP passes `startMenuMusic` to unlock audio on first
 *   interaction; MP omits it.
 * @returns {{
 *   get: () => string,
 *   select: (type: string) => void,
 *   tryKey: (e: KeyboardEvent) => boolean,
 * }}
 */
export function createWeaponPicker({ initial = 'spit', onSelect } = {}) {
  let selected = initial;

  const syncCards = (type) => {
    document.querySelectorAll('.weapon-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.weapon === type);
    });
  };

  const select = (type) => {
    selected = type;
    syncCards(type);
    if (onSelect) onSelect(type);
  };

  // Initial DOM sync so the default card shows as selected on load.
  syncCards(selected);

  return {
    get: () => selected,
    select,
    /**
     * Check a keyboard event against the weapon-picker hotkeys.
     * Returns true if the key was a weapon hotkey (1/2/3) and was
     * consumed; false otherwise. Callers compose their own keydown
     * visibility gates (start-screen-only, death-screen-only, etc.)
     * around this.
     */
    tryKey: (e) => {
      const type = WEAPON_KEYS[e.key];
      if (!type) return false;
      select(type);
      return true;
    },
  };
}
