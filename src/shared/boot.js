// Shared bootstrap services — wires things both SP and MP need at
// module load regardless of mode. Per the unification doc, this is
// where viewport resize, vol panel, mute button, keyboard binding,
// joystick, and achievement toast surface plumbing will land once
// steps 3 + 4 move the SP/MP init bodies in.
//
// Today this is an empty scaffold. SP's main.js and MP's mp-main.js
// still wire those services themselves at module load. Filling this
// in is part of step 3 (SP init move) — at which point each shared
// service's wiring shifts here from main.js, and main.js is rewritten
// to call `bootstrap({isMP:false})`.
//
// `isMP` is captured here so per-mode service variants (e.g. SP loads
// menu music, MP doesn't) can branch off it without threading the
// flag through every call site.
let _isMP = false;

export function bootSharedServices({ isMP } = {}) {
  _isMP = !!isMP;
  // Step 3 will move here:
  //   bindResize(canvas);
  //   bindTouchJoystick({ canvas, keys, analogMove: _isMP ? null : analogMove });
  //   updateMuteBtn(persistedMute);
  //   initVolSliders(persistedBgmVol, getSfxVol());
  //   installKeyboardInput(keys, { onLevelUpKey, onClear });
  //   bindWeaponPicker(callback) // once #weaponPicker lands
}

// Read back the captured mode for shared modules that need to vary
// behavior. Avoids re-passing `isMP` through every helper signature.
export function isMPMode() { return _isMP; }
