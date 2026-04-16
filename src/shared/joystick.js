// Mobile invisible touch joystick + page-level touch defaults.
//
// Both SP and MP have near-identical joystick handlers; the only real
// divergence is that SP needs an analog magnitude vector (so weapons
// that aim by player heading get a smooth direction + speed), while
// MP only needs boolean keys (server reads keyboard inputs, not analog
// magnitude). Pass `analogMove` to opt into analog mode; omit for the
// MP boolean-only path.
//
// This bundle ALSO installs the page-level touch defaults (preventing
// pinch-zoom on canvas and joystick, prevent double-tap zoom, prevent
// long-press contextmenu) since those were duplicated 1:1 in both
// entries and only make sense alongside the joystick.
//
// Extracted per BOOTSTRAP-UNIFICATION.md step 1, closing out the
// pre-work before step 2 entry.js scaffolding.

const JOY_DEAD = 15;     // pixels of slop before motion registers
const JOY_FULL = 60;     // pixels for analog magnitude = 1
const JOY_KEY_THRESH = 0.3; // boolean key engages past this fraction

// Wires the joystick + global touch defaults. `keys` is the boolean
// input map (`keys.left/right/up/down`), `analogMove` is an optional
// `{x, y}` vector for SP analog reads. `canvas` is the gameplay
// canvas (used to allow / block default touch behavior).
export function bindTouchJoystick({ canvas, keys, analogMove = null }) {
  const joyZone = document.getElementById('joystick-zone');
  const touchHint = document.getElementById('touch-hint');
  if (!joyZone) return; // no-op if the markup isn't present
  let joyTouchId = null;
  let joyOrigin = null;
  let hintShown = false;
  const writeAnalog = !!analogMove;

  const clear = () => {
    if (writeAnalog) { analogMove.x = 0; analogMove.y = 0; }
    keys.left = keys.right = keys.up = keys.down = false;
  };

  joyZone.addEventListener('touchstart', e => {
    if (joyTouchId !== null) return;
    const t = e.changedTouches[0];
    joyTouchId = t.identifier;
    joyOrigin = { x: t.clientX, y: t.clientY };
    if (!hintShown && touchHint) {
      hintShown = true;
      touchHint.style.opacity = '0';
      setTimeout(() => { touchHint.style.display = 'none'; }, 1000);
    }
    e.preventDefault();
  }, { passive: false });

  joyZone.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyTouchId) continue;
      const dx = t.clientX - joyOrigin.x;
      const dy = t.clientY - joyOrigin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > JOY_DEAD) {
        const nx = dx / dist, ny = dy / dist;
        if (writeAnalog) {
          // Analog: magnitude clamps to 1 at JOY_FULL pixels of pull.
          // Bool keys still ride along so weapon aim logic that reads
          // direction from keys (vs. analog) keeps working.
          const mag = Math.min(dist / JOY_FULL, 1);
          analogMove.x = nx * mag;
          analogMove.y = ny * mag;
        }
        keys.left = nx < -JOY_KEY_THRESH;
        keys.right = nx > JOY_KEY_THRESH;
        keys.up = ny < -JOY_KEY_THRESH;
        keys.down = ny > JOY_KEY_THRESH;
      } else {
        clear();
      }
    }
    e.preventDefault();
  }, { passive: false });

  const joyEnd = e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyTouchId) continue;
      joyTouchId = null;
      joyOrigin = null;
      clear();
    }
  };
  joyZone.addEventListener('touchend', joyEnd, { passive: false });
  joyZone.addEventListener('touchcancel', joyEnd, { passive: false });

  // Page-level defaults — block scroll/zoom inside the gameplay area
  // and the joyzone, allow normal touch behavior elsewhere (so menus,
  // links, etc. still work).
  document.addEventListener('touchmove', e => {
    if (e.target === canvas || e.target === joyZone || joyZone.contains(e.target)) {
      e.preventDefault();
    }
  }, { passive: false });

  // Block double-tap zoom (300ms double-tap window).
  let lastTap = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTap < 300) e.preventDefault();
    lastTap = now;
  }, { passive: false });

  // Block long-press contextmenu.
  document.addEventListener('contextmenu', e => e.preventDefault());
}
