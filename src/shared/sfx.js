// Shared SFX / audio module — used by both SP (src/main.js) and MP
// (src/mp-main.js). Each entry point loaded its own copy of the
// switch + audio-context boilerplate; collapsing here means new
// sfx types land once and both clients pick them up. Also fixes
// the prior gap where MP's switch was missing several cases that
// applySimEvent fired (charge, hive_burst, shield_hum, zap, etc.)
// — every event silently played nothing in MP.
//
// BGM lives in the entry points because each mode has different
// music plumbing (SP has menu + battle crossfade; MP has battle
// only). BGM reads the audio context via getAudioCtx().
//
// Persistence: sfxVol is read from localStorage on module load and
// written back via setSfxVol so volume slider state survives reloads.

let audioCtx = null;
let sfxMaster = null;
let sfxVol = 0.60;
const MAX_CONCURRENT_SFX = 12;
let activeSfxCount = 0;

try {
  if (typeof localStorage !== 'undefined') {
    const v = localStorage.getItem('survivors_sfx_vol');
    if (v !== null) sfxVol = +v;
  }
} catch (_) { /* localStorage unavailable */ }

export function getSfxVol() { return sfxVol; }

export function setSfxVol(v) {
  sfxVol = Math.max(0, Math.min(1, v));
  try { localStorage.setItem('survivors_sfx_vol', sfxVol.toFixed(2)); } catch (_) {}
  if (sfxMaster) sfxMaster.gain.value = sfxVol;
}

// Returns the shared AudioContext, lazily creating it + the SFX
// master gain on first call. Callers that need to wire up music
// nodes (BGM in entry points) connect to ac.destination directly,
// bypassing sfxMaster so the BGM volume slider stays independent.
export function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sfxMaster = audioCtx.createGain();
    sfxMaster.gain.value = sfxVol;
    sfxMaster.connect(audioCtx.destination);
  }
  return audioCtx;
}

function getSfxDest() { return sfxMaster || (getAudioCtx() && sfxMaster); }

// Play a sound effect by name. All sfx route through sfxMaster
// (volume controlled), with a hard cap on concurrent oscillators
// so a chain-lightning volley doesn't drown out the BGM.
export function sfx(type) {
  try {
    const ac = getAudioCtx();
    if (activeSfxCount >= MAX_CONCURRENT_SFX) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const dest = getSfxDest();
    osc.connect(gain);
    gain.connect(dest);
    activeSfxCount++;
    osc.onended = () => { activeSfxCount = Math.max(0, activeSfxCount - 1); };

    switch (type) {
      case 'hit':
        osc.type = 'square';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.linearRampToValueAtTime(110, t + 0.06);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.06);
        osc.start(t); osc.stop(t + 0.06);
        break;

      case 'kill':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.linearRampToValueAtTime(800, t + 0.08);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.1);
        osc.start(t); osc.stop(t + 0.1);
        break;

      case 'xp':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.linearRampToValueAtTime(1320, t + 0.06);
        gain.gain.setValueAtTime(0.06, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.08);
        osc.start(t); osc.stop(t + 0.08);
        break;

      case 'levelup': {
        gain.gain.setValueAtTime(0, t);
        osc.start(t); osc.stop(t + 0.01);
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.connect(g); g.connect(dest);
          o.type = 'triangle';
          o.frequency.setValueAtTime(freq, t + i * 0.08);
          g.gain.setValueAtTime(0.1, t + i * 0.08);
          g.gain.linearRampToValueAtTime(0, t + i * 0.08 + 0.12);
          o.start(t + i * 0.08);
          o.stop(t + i * 0.08 + 0.12);
        });
        break;
      }

      case 'playerhit':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.linearRampToValueAtTime(80, t + 0.12);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.15);
        osc.start(t); osc.stop(t + 0.15);
        break;

      case 'death': {
        gain.gain.setValueAtTime(0, t);
        osc.start(t); osc.stop(t + 0.01);
        const freqs = [440, 330, 220, 110];
        freqs.forEach((freq, i) => {
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.connect(g); g.connect(dest);
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(freq, t + i * 0.15);
          o.frequency.linearRampToValueAtTime(freq * 0.7, t + i * 0.15 + 0.15);
          g.gain.setValueAtTime(0.12, t + i * 0.15);
          g.gain.linearRampToValueAtTime(0, t + i * 0.15 + 0.18);
          o.start(t + i * 0.15);
          o.stop(t + i * 0.15 + 0.18);
        });
        break;
      }

      case 'spit':
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.linearRampToValueAtTime(200, t + 0.07);
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.07);
        osc.start(t); osc.stop(t + 0.07);
        break;

      case 'chain':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.linearRampToValueAtTime(300, t + 0.05);
        osc.frequency.linearRampToValueAtTime(900, t + 0.08);
        osc.frequency.linearRampToValueAtTime(200, t + 0.12);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.12);
        osc.start(t); osc.stop(t + 0.12);
        break;

      case 'meteor':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(60, t);
        osc.frequency.linearRampToValueAtTime(40, t + 0.2);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.25);
        osc.start(t); osc.stop(t + 0.25);
        break;

      case 'dragonstorm': {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, t);
        osc.frequency.linearRampToValueAtTime(200, t + 0.1);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.15);
        osc.start(t); osc.stop(t + 0.15);
        const o2 = ac.createOscillator();
        const g2 = ac.createGain();
        o2.connect(g2); g2.connect(dest);
        o2.type = 'square';
        o2.frequency.setValueAtTime(800, t + 0.03);
        o2.frequency.linearRampToValueAtTime(400, t + 0.1);
        g2.gain.setValueAtTime(0.06, t + 0.03);
        g2.gain.linearRampToValueAtTime(0, t + 0.12);
        o2.start(t + 0.03); o2.stop(t + 0.12);
        break;
      }

      case 'charge': {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.linearRampToValueAtTime(300, t + 0.08);
        osc.frequency.linearRampToValueAtTime(80, t + 0.15);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.08);
        gain.gain.linearRampToValueAtTime(0, t + 0.2);
        osc.start(t); osc.stop(t + 0.2);
        break;
      }

      case 'hive_burst': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.linearRampToValueAtTime(90, t + 0.08);
        osc.frequency.linearRampToValueAtTime(200, t + 0.12);
        osc.frequency.linearRampToValueAtTime(60, t + 0.2);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.08);
        gain.gain.linearRampToValueAtTime(0, t + 0.2);
        osc.start(t); osc.stop(t + 0.2);
        const hb2 = ac.createOscillator();
        const hg2 = ac.createGain();
        hb2.connect(hg2); hg2.connect(dest);
        hb2.type = 'square';
        hb2.frequency.setValueAtTime(500, t + 0.02);
        hb2.frequency.linearRampToValueAtTime(250, t + 0.1);
        hb2.frequency.linearRampToValueAtTime(600, t + 0.15);
        hg2.gain.setValueAtTime(0.04, t + 0.02);
        hg2.gain.linearRampToValueAtTime(0, t + 0.18);
        hb2.start(t + 0.02); hb2.stop(t + 0.18);
        break;
      }

      case 'boss_telegraph': {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(60, t);
        osc.frequency.linearRampToValueAtTime(180, t + 0.25);
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.2);
        gain.gain.linearRampToValueAtTime(0, t + 0.3);
        osc.start(t); osc.stop(t + 0.3);
        const bt2 = ac.createOscillator();
        const bg2 = ac.createGain();
        bt2.connect(bg2); bg2.connect(dest);
        bt2.type = 'square';
        bt2.frequency.setValueAtTime(300, t + 0.1);
        bt2.frequency.linearRampToValueAtTime(600, t + 0.25);
        bg2.gain.setValueAtTime(0.03, t + 0.1);
        bg2.gain.linearRampToValueAtTime(0.08, t + 0.22);
        bg2.gain.linearRampToValueAtTime(0, t + 0.3);
        bt2.start(t + 0.1); bt2.stop(t + 0.3);
        break;
      }

      case 'boss_step': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(50, t);
        osc.frequency.linearRampToValueAtTime(30, t + 0.1);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.12);
        osc.start(t); osc.stop(t + 0.12);
        break;
      }

      case 'shield_hum': {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.linearRampToValueAtTime(260, t + 0.06);
        osc.frequency.linearRampToValueAtTime(220, t + 0.12);
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.04);
        gain.gain.linearRampToValueAtTime(0, t + 0.12);
        osc.start(t); osc.stop(t + 0.12);
        break;
      }

      case 'heal': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.linearRampToValueAtTime(784, t + 0.1);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0.06, t + 0.08);
        gain.gain.linearRampToValueAtTime(0, t + 0.15);
        osc.start(t); osc.stop(t + 0.15);
        const ho2 = ac.createOscillator();
        const hg2 = ac.createGain();
        ho2.connect(hg2); hg2.connect(dest);
        ho2.type = 'sine';
        ho2.frequency.setValueAtTime(659, t + 0.05);
        ho2.frequency.linearRampToValueAtTime(1047, t + 0.15);
        hg2.gain.setValueAtTime(0.06, t + 0.05);
        hg2.gain.linearRampToValueAtTime(0, t + 0.2);
        ho2.start(t + 0.05); ho2.stop(t + 0.2);
        break;
      }

      case 'zap': {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(2000, t);
        osc.frequency.linearRampToValueAtTime(600, t + 0.03);
        osc.frequency.linearRampToValueAtTime(1800, t + 0.05);
        osc.frequency.linearRampToValueAtTime(400, t + 0.08);
        gain.gain.setValueAtTime(0.07, t);
        gain.gain.linearRampToValueAtTime(0.04, t + 0.03);
        gain.gain.linearRampToValueAtTime(0.06, t + 0.05);
        gain.gain.linearRampToValueAtTime(0, t + 0.08);
        osc.start(t); osc.stop(t + 0.08);
        break;
      }

      default:
        gain.gain.setValueAtTime(0, t);
        osc.start(t); osc.stop(t + 0.01);
    }
  } catch (e) { /* audio not available */ }
}
