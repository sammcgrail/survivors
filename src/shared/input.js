// Shared keyboard input — installs keydown/keyup handlers that
// translate WASD + arrow keys into a `keys` boolean object the
// caller owns. Both SP and MP use the same WASD→intent mapping;
// the divergence is only in what they DO with `keys` (SP applies
// to g.player movement, MP serializes + sends over WS).
//
// Joystick + touch controls stay per-mode — SP has analog with
// magnitude scaling, MP only sends boolean keys to the server,
// so the analog↔boolean conversion logic differs enough to keep
// inline in the entry points.

export const KEY_MAP = {
  'w': 'up', 'arrowup': 'up',
  's': 'down', 'arrowdown': 'down',
  'a': 'left', 'arrowleft': 'left',
  'd': 'right', 'arrowright': 'right',
};

// Install keydown/keyup + window-blur reset on the document.
// `keys` is the caller-owned boolean object, mutated in place.
//
// `opts.onLevelUpKey(idx)` (optional) — called for number keys
// 1/2/3 when a level-up overlay is open, callback decides whether
// to actually consume. SP has its own pause check; MP gates on
// the overlay element. Returning true from the callback signals
// the key was handled (we'll preventDefault).
export function installKeyboardInput(keys, opts = {}) {
  const onLevelUpKey = opts.onLevelUpKey;

  document.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (onLevelUpKey && /^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (onLevelUpKey(idx)) { e.preventDefault(); return; }
    }
    const k = KEY_MAP[e.key.toLowerCase()];
    if (k) { keys[k] = true; e.preventDefault(); }
  });

  document.addEventListener('keyup', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const k = KEY_MAP[e.key.toLowerCase()];
    if (k) { keys[k] = false; e.preventDefault(); }
  });

  // Clear input on blur / tab hide. Without this, holding a key,
  // alt-tabbing, and releasing while hidden leaves the key
  // permanently "down" — player drifts forever after returning.
  // Same pattern fires on mobile home-button.
  const clear = () => clearAllInput(keys, opts.onClear);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
}

// Reset the WASD booleans + invoke the optional onClear hook for
// per-mode extras (SP's analog joystick coordinates, etc).
export function clearAllInput(keys, onClear) {
  keys.up = keys.down = keys.left = keys.right = false;
  if (onClear) onClear();
}
