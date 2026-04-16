// Volume panel — mute toggle + bgm/sfx slider plumbing. Shared helpers
// for the text-identical bits between SP and MP; entries keep their
// own `setBgmVol(v)` because the music-wiring divergence (SP has menu
// + battle crossfade, MP has battle only) is genuine and small enough
// not to be worth a factory. Extracted per BOOTSTRAP-UNIFICATION.md
// step 1.
//
// localStorage keys are fixed — both modes read/write the same slots
// so mute + volume persist across SP↔MP mode switches.

export const LS_BGM_VOL_KEY = 'survivors_bgm_vol';
export const LS_MUTE_KEY    = 'survivors_mute';
export const BGM_VOL_DEFAULT = 0.45;

// Slider values are 0..100; internal volume is 0..1. Shared clamp
// keeps both entries using the same range without drift.
export function clampSliderVol(v) { return Math.max(0, Math.min(1, v / 100)); }

export function readPersistedBgmVol() {
  try {
    const raw = localStorage.getItem(LS_BGM_VOL_KEY);
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : BGM_VOL_DEFAULT;
  } catch { return BGM_VOL_DEFAULT; }
}

export function readPersistedMute() {
  try { return localStorage.getItem(LS_MUTE_KEY) === '1'; }
  catch { return false; }
}

export function persistBgmVol(v) {
  try { localStorage.setItem(LS_BGM_VOL_KEY, v.toFixed(2)); } catch {}
}

export function persistMute(muted) {
  try { localStorage.setItem(LS_MUTE_KEY, muted ? '1' : '0'); } catch {}
}

// DOM wiring helpers — DOM-dependent so this module stays outside
// shared/sim/. Both modes share the `#mute-btn`, `#vol-panel`,
// `#vol-bgm`, `#vol-sfx` element IDs (template.html is single-source).
export function updateMuteBtn(muted) {
  const b = document.getElementById('mute-btn');
  if (b) b.textContent = muted ? '🔇' : '🔊';
}

export function initVolSliders(bgmVol, sfxVol) {
  const bs = document.getElementById('vol-bgm');
  const ss = document.getElementById('vol-sfx');
  if (bs) bs.value = Math.round(bgmVol * 100);
  if (ss) ss.value = Math.round(sfxVol * 100);
}

export function toggleVolPanel() {
  const p = document.getElementById('vol-panel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}
