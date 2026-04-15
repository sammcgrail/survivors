// Shared BGM player factory. SP needs two players (menu + battle
// crossfade) and MP needs one (battle only) — but both want the
// same primitives: Audio element + GainNode, fade-in/out, swap
// track, volume control, mute toggle.
//
// Each call to makeBgmPlayer() returns an independent player —
// owns its own Audio + GainNode lifetime, doesn't share state
// with other players. Audio context is the one from shared/sfx.js
// (passed in so the BGM gains route through ac.destination
// alongside the SFX master, not through it).

import { getAudioCtx } from './sfx.js';

export function makeBgmPlayer() {
  let audio = null;
  let gain = null;
  let currentSrc = null;
  let fading = false;

  // Start (or swap to) `src` with a fade-in. Same-src calls just
  // ramp the gain back up (resume from where we paused) — used for
  // SP's menu-music fade back in after returning from a game so the
  // track doesn't restart from 0:00. Different src tears down the
  // old Audio (createMediaElementSource binds permanently to one
  // element).
  function play(src, targetVol, fadeInSec = 2) {
    try {
      const ac = getAudioCtx();
      if (ac.state === 'suspended') ac.resume();
      if (audio && currentSrc !== src) {
        audio.pause();
        audio = null;
        gain = null;
      }
      const fresh = !audio;
      if (fresh) {
        audio = new Audio();
        audio.loop = true;
        audio.volume = 1; // volume controlled via gain node
        audio.src = src;
        currentSrc = src;
        const mediaSrc = ac.createMediaElementSource(audio);
        gain = ac.createGain();
        gain.gain.value = 0;
        mediaSrc.connect(gain);
        gain.connect(ac.destination);
      }
      // Fresh track starts from 0; resumed track keeps its position.
      if (fresh) audio.currentTime = 0;
      audio.play().catch(() => {});
      gain.gain.cancelScheduledValues(ac.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ac.currentTime);
      gain.gain.linearRampToValueAtTime(targetVol, ac.currentTime + fadeInSec);
      fading = false;
    } catch (_) {}
  }

  // Smooth fade out then pause. fadeOutSec defaults to 1.5s. No-op
  // if not playing or already fading. Audio element stays loaded
  // so the next play() can resume without re-fetch.
  function fadeOut(fadeOutSec = 1.5) {
    if (!audio || !gain || fading) return;
    fading = true;
    try {
      const ac = getAudioCtx();
      gain.gain.cancelScheduledValues(ac.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ac.currentTime);
      gain.gain.linearRampToValueAtTime(0, ac.currentTime + fadeOutSec);
      setTimeout(() => { audio && audio.pause(); fading = false; }, fadeOutSec * 1000 + 100);
    } catch (_) {}
  }

  // Smooth ramp to a new volume target (used for slider drag +
  // mute toggle). 100ms is short enough to feel instant.
  function setVol(vol, rampSec = 0.1) {
    if (!gain) return;
    try {
      const ac = getAudioCtx();
      gain.gain.cancelScheduledValues(ac.currentTime);
      gain.gain.linearRampToValueAtTime(vol, ac.currentTime + rampSec);
    } catch (_) {}
  }

  return { play, fadeOut, setVol, get isLoaded() { return audio !== null; } };
}
