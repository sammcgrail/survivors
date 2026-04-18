// Music director — orchestrates menu + battle BGM players with crossfade,
// mute toggle, and per-map track selection. Shared between SP and MP.
//
// SP creates with `{ hasMenu: true }` (menu + battle players, crossfade
// between start screen and gameplay). MP creates with `{ hasMenu: false }`
// (battle player only — no start screen music).
//
// Extracted per docs/BOOTSTRAP-UNIFICATION.md step 1: the last shared
// surface before bootstrap unification. Follows the same decorator
// pattern as shared/volPanel.js and shared/weaponPicker.js.

import { makeBgmPlayer } from './bgm.js';
import {
  readPersistedBgmVol, readPersistedMute,
  persistBgmVol, persistMute, updateMuteBtn, initVolSliders,
  clampSliderVol,
} from './volPanel.js';
import { getSfxVol } from './sfx.js';

const MAP_TRACKS = {
  arena: 'arena_theme.ogg',
  neon: 'neon_grid.ogg',
  forest: 'forest_theme.ogg',
  graveyard: 'graveyard_theme.ogg',
  ruins: 'ruins_theme.ogg',
  wilderness: 'wilderness_theme.ogg',
  catacombs: 'catacombs_theme.ogg',
};
const MENU_TRACK = 'menu_theme.ogg';
const DEFAULT_TRACK_OGG = 'survivors_battle.ogg';
// Menu music plays at 92% of bgm slider — slight duck keeps it from
// overpowering selection-click sfx. Was 0.67 but menu was too quiet
// (default bgmVol 0.45 * 0.67 = 0.30, barely audible).
const MENU_VOL_RATIO = 0.92;

/**
 * Initialize the music director. Call once at module load.
 *
 * @param {Object} opts
 * @param {boolean} opts.hasMenu  SP = true (menu + battle), MP = false (battle only).
 * @returns Music director API.
 */
export function initMusic({ hasMenu = false } = {}) {
  let bgmVol = readPersistedBgmVol();
  let muted = readPersistedMute();
  let menuMusicStarted = false;

  const battlePlayer = makeBgmPlayer();
  const menuPlayer = hasMenu ? makeBgmPlayer() : null;

  // Wire initial DOM state.
  updateMuteBtn(muted);
  initVolSliders(bgmVol, getSfxVol());

  function startBattleMusic(mapId) {
    const src = MAP_TRACKS[mapId] || DEFAULT_TRACK_OGG;
    battlePlayer.play(src, muted ? 0 : bgmVol);
  }

  function fadeOutBattleMusic() {
    battlePlayer.fadeOut();
  }

  function startMenuMusic() {
    if (!hasMenu || !menuPlayer) return;
    if (menuMusicStarted) return;
    menuPlayer.play(MENU_TRACK, muted ? 0 : bgmVol * MENU_VOL_RATIO);
    menuMusicStarted = true;
  }

  function fadeOutMenuMusic() {
    if (!menuPlayer) return;
    menuPlayer.fadeOut();
  }

  function fadeInMenuMusic() {
    if (!menuPlayer) return;
    menuPlayer.play(MENU_TRACK, muted ? 0 : bgmVol * MENU_VOL_RATIO);
  }

  function toggleMute() {
    muted = !muted;
    persistMute(muted);
    updateMuteBtn(muted);
    battlePlayer.setVol(muted ? 0 : bgmVol, 0.3);
    if (menuPlayer) menuPlayer.setVol(muted ? 0 : bgmVol * MENU_VOL_RATIO, 0.3);
  }

  function setBgmVol(v) {
    bgmVol = clampSliderVol(v);
    persistBgmVol(bgmVol);
    if (!muted) {
      battlePlayer.setVol(bgmVol);
      if (menuPlayer) menuPlayer.setVol(bgmVol * MENU_VOL_RATIO);
    }
  }

  function setMuted(m) {
    if (m === muted) return;
    toggleMute();
  }

  return {
    startBattleMusic,
    fadeOutBattleMusic,
    startMenuMusic,
    fadeOutMenuMusic,
    fadeInMenuMusic,
    toggleMute,
    setBgmVol,
    setMuted,
  };
}
