// Shared bootstrap services — wires things both SP and MP need at
// startup. Per docs/BOOTSTRAP-UNIFICATION.md step 3, this owns:
//   - canvas + 2d context (pixel-art settings)
//   - sprite sheet loading
//   - viewport resize binding
//   - music director init
//   - vol panel + mute button DOM wiring
//
// Mode-specific wiring (keyboard callbacks, joystick analogMove, etc.)
// stays in bootSPGame / bootMPGame since the callback shapes differ.
//
// `isMP` is captured here so shared modules can branch on mode without
// threading the flag through every call site.

import { bindResize } from './viewport.js';
import { initMusic } from './musicDirector.js';
import { toggleVolPanel } from './volPanel.js';
import { makeDrawSprite } from './render.js';

let _isMP = false;

/**
 * Wire shared services used by both SP and MP.
 *
 * @param {Object} opts
 * @param {boolean} opts.isMP  true for MP, false for SP.
 * @returns {{ canvas, ctx, drawSprite, music }}
 */
export function bootSharedServices({ isMP } = {}) {
  _isMP = !!isMP;

  if (typeof document === 'undefined') return { canvas: null, ctx: null, drawSprite: null, music: null };

  // --- canvas + 2d context ---
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  // Pixel art needs nearest-neighbor scaling. Set once so drawSprite
  // doesn't reassign it 2000+ times per frame at high enemy density.
  ctx.imageSmoothingEnabled = false;

  // --- sprite sheet ---
  const spriteSheet = new Image();
  spriteSheet.src = 'sprites.png';
  let spritesReady = false;
  spriteSheet.onload = () => { spritesReady = true; };
  const drawSprite = makeDrawSprite(ctx, spriteSheet, () => spritesReady);

  // --- viewport resize ---
  bindResize(canvas);

  // --- music director ---
  const music = initMusic({ hasMenu: !isMP });

  // --- expose vol panel toggle for HTML onclick ---
  window.toggleVolPanel = toggleVolPanel;

  return { canvas, ctx, drawSprite, music };
}

// Read back the captured mode for shared modules that need to vary
// behavior. Avoids re-passing `isMP` through every helper signature.
export function isMPMode() { return _isMP; }
