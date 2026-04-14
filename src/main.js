// ============================================================
// SURVIVORS v1a — single-player client entry point
// Bundled by scripts/build.js → bundle.js (loaded by v1a.html)
// ============================================================

import { SPRITE_SIZE, SP } from './shared/sprites.js';
import { WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP, XP_RADIUS, XP_MAGNET_RANGE, XP_MAGNET_SPEED } from './shared/constants.js';
import { WEAPON_ICONS, createWeapon } from './shared/weapons.js';
import { ENEMY_TYPES, WAVE_POOLS, SPECIAL_WAVES, enemyType, scaleEnemy } from './shared/enemyTypes.js';
import { createRng } from './shared/sim/rng.js';
import { EVT, emit } from './shared/sim/events.js';
import { spawnGem, updateGems } from './shared/sim/gems.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
// Pixel art needs nearest-neighbor scaling. Set once here so drawSprite
// doesn't have to reassign it 2000+ times per frame at high enemy density.
ctx.imageSmoothingEnabled = false;

// Cached HUD elements + last-written values so we don't thrash the DOM.
const hudEl = {
  time:    document.getElementById('hud-time'),
  level:   document.getElementById('hud-level'),
  kills:   document.getElementById('hud-kills'),
  wave:    document.getElementById('hud-wave'),
  weapons: document.getElementById('hud-weapons'),
  xpFill:  document.getElementById('xp-fill'),
};
const hudCache = { time: '', level: '', kills: '', wave: '', weapons: '', xpPct: -1 };
function setHud(key, str) {
  if (str !== hudCache[key]) { hudEl[key].textContent = str; hudCache[key] = str; }
}

// --- sprite sheet ---
const spriteSheet = new Image();
spriteSheet.src = 'sprites.png';
let spritesReady = false;
spriteSheet.onload = () => { spritesReady = true; };

// imageSmoothingEnabled is set once at canvas init (search for `ctx = canvas.getContext`).
// drawSprite avoids per-call state churn: only touches globalAlpha when an explicit
// alpha is passed, and skips the read-and-restore pair in the common case.
function drawSprite(name, x, y, scale, alpha) {
  if (!spritesReady || !SP[name]) return false;
  const sp = SP[name];
  const s = SPRITE_SIZE;
  const drawSize = s * (scale || 2);
  const half = drawSize * 0.5;
  if (alpha !== undefined) {
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.drawImage(spriteSheet, sp[0] * s, sp[1] * s, s, s, x - half, y - half, drawSize, drawSize);
    ctx.globalAlpha = prev;
  } else {
    ctx.drawImage(spriteSheet, sp[0] * s, sp[1] * s, s, s, x - half, y - half, drawSize, drawSize);
  }
  return true;
}

// --- sound effects (Web Audio API) ---
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function sfx(type) {
  try {
    const ac = getAudio();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);

    switch (type) {
      case 'hit': // enemy takes damage — short blip
        osc.type = 'square';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.linearRampToValueAtTime(110, t + 0.06);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.06);
        osc.start(t); osc.stop(t + 0.06);
        break;

      case 'kill': // enemy dies — satisfying pop
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.linearRampToValueAtTime(800, t + 0.08);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.1);
        osc.start(t); osc.stop(t + 0.1);
        break;

      case 'xp': // gem pickup — tiny chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.linearRampToValueAtTime(1320, t + 0.06);
        gain.gain.setValueAtTime(0.06, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.08);
        osc.start(t); osc.stop(t + 0.08);
        break;

      case 'levelup': { // level up — ascending arpeggio
        gain.gain.setValueAtTime(0, t); // silence main osc
        osc.start(t); osc.stop(t + 0.01);
        const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
        notes.forEach((freq, i) => {
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.connect(g); g.connect(ac.destination);
          o.type = 'triangle';
          o.frequency.setValueAtTime(freq, t + i * 0.08);
          g.gain.setValueAtTime(0.1, t + i * 0.08);
          g.gain.linearRampToValueAtTime(0, t + i * 0.08 + 0.12);
          o.start(t + i * 0.08);
          o.stop(t + i * 0.08 + 0.12);
        });
        break;
      }

      case 'playerhit': // player takes damage — harsh buzz
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.linearRampToValueAtTime(80, t + 0.12);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.15);
        osc.start(t); osc.stop(t + 0.15);
        break;

      case 'death': { // player death — descending doom
        gain.gain.setValueAtTime(0, t);
        osc.start(t); osc.stop(t + 0.01);
        const freqs = [440, 330, 220, 110];
        freqs.forEach((freq, i) => {
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.connect(g); g.connect(ac.destination);
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

      case 'spit': // projectile fire — pew
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.linearRampToValueAtTime(200, t + 0.07);
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.07);
        osc.start(t); osc.stop(t + 0.07);
        break;

      case 'chain': // chain lightning — electric zap
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.linearRampToValueAtTime(300, t + 0.05);
        osc.frequency.linearRampToValueAtTime(900, t + 0.08);
        osc.frequency.linearRampToValueAtTime(200, t + 0.12);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.12);
        osc.start(t); osc.stop(t + 0.12);
        break;

      case 'meteor': // meteor drop — deep rumble whomp
        osc.type = 'sine';
        osc.frequency.setValueAtTime(60, t);
        osc.frequency.linearRampToValueAtTime(40, t + 0.2);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.25);
        osc.start(t); osc.stop(t + 0.25);
        break;

      case 'dragonstorm': { // dragon storm — deep roar + high sizzle
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, t);
        osc.frequency.linearRampToValueAtTime(200, t + 0.1);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.15);
        osc.start(t); osc.stop(t + 0.15);
        const o2 = ac.createOscillator();
        const g2 = ac.createGain();
        o2.connect(g2); g2.connect(ac.destination);
        o2.type = 'square';
        o2.frequency.setValueAtTime(800, t + 0.03);
        o2.frequency.linearRampToValueAtTime(400, t + 0.1);
        g2.gain.setValueAtTime(0.06, t + 0.03);
        g2.gain.linearRampToValueAtTime(0, t + 0.12);
        o2.start(t + 0.03); o2.stop(t + 0.12);
        break;
      }

      case 'charge': { // bull rush — woosh + impact thud
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

      case 'hive_burst': { // spawner births swarmlings — organic squelchy burst
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.linearRampToValueAtTime(90, t + 0.08);
        osc.frequency.linearRampToValueAtTime(200, t + 0.12);
        osc.frequency.linearRampToValueAtTime(60, t + 0.2);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.08);
        gain.gain.linearRampToValueAtTime(0, t + 0.2);
        osc.start(t); osc.stop(t + 0.2);
        // high squelch layer
        const hb2 = ac.createOscillator();
        const hg2 = ac.createGain();
        hb2.connect(hg2); hg2.connect(ac.destination);
        hb2.type = 'square';
        hb2.frequency.setValueAtTime(500, t + 0.02);
        hb2.frequency.linearRampToValueAtTime(250, t + 0.1);
        hb2.frequency.linearRampToValueAtTime(600, t + 0.15);
        hg2.gain.setValueAtTime(0.04, t + 0.02);
        hg2.gain.linearRampToValueAtTime(0, t + 0.18);
        hb2.start(t + 0.02); hb2.stop(t + 0.18);
        break;
      }

      case 'boss_telegraph': { // boss about to charge — rising growl warning
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(60, t);
        osc.frequency.linearRampToValueAtTime(180, t + 0.25);
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.2);
        gain.gain.linearRampToValueAtTime(0, t + 0.3);
        osc.start(t); osc.stop(t + 0.3);
        // high screech overtone
        const bt2 = ac.createOscillator();
        const bg2 = ac.createGain();
        bt2.connect(bg2); bg2.connect(ac.destination);
        bt2.type = 'square';
        bt2.frequency.setValueAtTime(300, t + 0.1);
        bt2.frequency.linearRampToValueAtTime(600, t + 0.25);
        bg2.gain.setValueAtTime(0.03, t + 0.1);
        bg2.gain.linearRampToValueAtTime(0.08, t + 0.22);
        bg2.gain.linearRampToValueAtTime(0, t + 0.3);
        bt2.start(t + 0.1); bt2.stop(t + 0.3);
        break;
      }

      case 'boss_step': { // boss footstep — heavy thud
        osc.type = 'sine';
        osc.frequency.setValueAtTime(50, t);
        osc.frequency.linearRampToValueAtTime(30, t + 0.1);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.12);
        osc.start(t); osc.stop(t + 0.12);
        break;
      }

      case 'shield_hum': { // barrier shield pulse — resonant hum
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

      case 'heal': { // health pickup — warm ascending chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.linearRampToValueAtTime(784, t + 0.1);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0.06, t + 0.08);
        gain.gain.linearRampToValueAtTime(0, t + 0.15);
        osc.start(t); osc.stop(t + 0.15);
        const ho2 = ac.createOscillator();
        const hg2 = ac.createGain();
        ho2.connect(hg2); hg2.connect(ac.destination);
        ho2.type = 'sine';
        ho2.frequency.setValueAtTime(659, t + 0.05);
        ho2.frequency.linearRampToValueAtTime(1047, t + 0.15);
        hg2.gain.setValueAtTime(0.06, t + 0.05);
        hg2.gain.linearRampToValueAtTime(0, t + 0.2);
        ho2.start(t + 0.05); ho2.stop(t + 0.2);
        break;
      }

      case 'zap': { // lightning field strike — sharp crackling zap
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
  } catch (e) { /* audio not available, that's fine */ }
}

// --- analytics (fire-and-forget, never blocks gameplay) ---
const ANALYTICS_URL = 'https://survivors-analytics.sammcgrail.workers.dev';
let sessionStart = Date.now();
const track = (event) => fetch(`${ANALYTICS_URL}/event`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(event),
}).catch(() => {});
track({ type: 'page_load' });
window.addEventListener('beforeunload', () => {
  track({ type: 'session_end', duration_ms: Date.now() - sessionStart });
});

// --- battle music ---
let bgMusic = null;
let bgMusicGain = null;
let musicFading = false;

function startMusic() {
  try {
    const ac = getAudio();
    if (ac.state === 'suspended') ac.resume();
    if (!bgMusic) {
      // Safari doesn't support ogg — try mp3 fallback
      bgMusic = new Audio();
      bgMusic.loop = true;
      bgMusic.volume = 1; // volume controlled via gain node, not element
      if (bgMusic.canPlayType('audio/ogg; codecs=vorbis')) {
        bgMusic.src = 'survivors_battle.ogg';
      } else {
        bgMusic.src = 'survivors_battle.mp3';
      }
      const src = ac.createMediaElementSource(bgMusic);
      bgMusicGain = ac.createGain();
      bgMusicGain.gain.value = 0;
      src.connect(bgMusicGain);
      bgMusicGain.connect(ac.destination);
    }
    bgMusic.currentTime = 0;
    bgMusic.play().catch(() => {});
    // fade in over 2s
    bgMusicGain.gain.cancelScheduledValues(ac.currentTime);
    bgMusicGain.gain.setValueAtTime(0, ac.currentTime);
    bgMusicGain.gain.linearRampToValueAtTime(0.35, ac.currentTime + 2);
    musicFading = false;
  } catch (e) {}
}

function fadeOutMusic() {
  if (!bgMusic || !bgMusicGain || musicFading) return;
  musicFading = true;
  try {
    const ac = getAudio();
    bgMusicGain.gain.cancelScheduledValues(ac.currentTime);
    bgMusicGain.gain.setValueAtTime(bgMusicGain.gain.value, ac.currentTime);
    bgMusicGain.gain.linearRampToValueAtTime(0, ac.currentTime + 1.5);
    setTimeout(() => { bgMusic.pause(); musicFading = false; }, 1600);
  } catch (e) {}
}

// --- resize ---
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- constants ---
// --- game state ---
let game = null;
let keys = { up: false, down: false, left: false, right: false };
let analogMove = { x: 0, y: 0 }; // smooth analog input from touch
let paused = false;
let selectedWeapon = 'spit'; // default starting weapon

function selectWeapon(type) {
  selectedWeapon = type;
  document.querySelectorAll('.weapon-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.weapon === type);
  });
}
let gameStarted = false;

// --- powerups catalog ---
const POWERUPS = [
  { id: 'speed', name: 'Swift Feet', desc: 'Move 15% faster', icon: '⚡', stack: 0, max: 5, apply(g) { g.player.speed *= 1.15; } },
  { id: 'damage', name: 'Raw Power', desc: '+25% damage to all weapons', icon: '💥', stack: 0, max: 5, apply(g) { g.player.damageMulti *= 1.25; } },
  { id: 'hp_regen', name: 'Regeneration', desc: 'Heal 2 HP/sec', icon: '💚', stack: 0, max: 3, apply(g) { g.player.hpRegen += 2; } },
  { id: 'attack_speed', name: 'Haste', desc: '+20% attack speed', icon: '🔥', stack: 0, max: 5, apply(g) { g.player.attackSpeedMulti *= 1.2; } },
  { id: 'magnet', name: 'Magnet', desc: '+50% XP pickup range', icon: '🧲', stack: 0, max: 3, apply(g) { g.player.magnetRange *= 1.5; } },
  { id: 'max_hp', name: 'Vitality', desc: '+25 max HP, heal to full', icon: '❤️', stack: 0, max: 3, apply(g) { g.player.maxHp += 25; g.player.hp = g.player.maxHp; } },
  { id: 'weapon_spit', name: 'Magic Spit', desc: 'Projectile weapon — fires at nearest enemy', icon: '🔮', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('spit')); } },
  { id: 'weapon_breath', name: 'Dragon Breath', desc: 'Aura weapon — damages nearby enemies', icon: '🌀', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('breath')); } },
  { id: 'weapon_charge', name: 'Bull Rush', desc: 'Sweep weapon — charges in move direction', icon: '🐂', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('charge')); } },
  { id: 'weapon_orbit', name: 'Blade Orbit', desc: 'Orbiting blades damage enemies on contact', icon: '🗡️', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('orbit')); } },
  { id: 'weapon_chain', name: 'Chain Lightning', desc: 'Zaps nearest enemy, chains to 2 more', icon: '⚡', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('chain')); } },
  { id: 'weapon_meteor', name: 'Meteor', desc: 'Drops AoE on enemy clusters', icon: '☄️', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('meteor')); } },
  { id: 'weapon_shield', name: 'Barrier', desc: 'Knockback shield — pushes and damages nearby enemies', icon: '🛡️', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('shield')); } },
  { id: 'weapon_lightning_field', name: 'Lightning Field', desc: 'Passive zaps random nearby enemies', icon: '⚡', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('lightning_field')); } },
  { id: 'spit_up', name: 'Spit+', desc: 'Extra projectile + pierce', icon: '🔮+', stack: 0, max: 3, requires: 'weapon_spit', apply(g) { let w = g.player.weapons.find(w=>w.type==='spit'); if(w){w.count++;w.pierce++;} } },
  { id: 'breath_up', name: 'Breath+', desc: '+30% aura radius', icon: '🌀+', stack: 0, max: 3, requires: 'weapon_breath', apply(g) { let w = g.player.weapons.find(w=>w.type==='breath'); if(w) w.radius *= 1.3; } },
  { id: 'charge_up', name: 'Rush+', desc: '+40% charge damage & width', icon: '🐂+', stack: 0, max: 3, requires: 'weapon_charge', apply(g) { let w = g.player.weapons.find(w=>w.type==='charge'); if(w){w.damage*=1.4;w.width*=1.4;} } },
  { id: 'orbit_up', name: 'Orbit+', desc: '+1 orbiting blade', icon: '🗡️+', stack: 0, max: 3, requires: 'weapon_orbit', apply(g) { let w = g.player.weapons.find(w=>w.type==='orbit'); if(w) w.bladeCount++; } },
  { id: 'chain_up', name: 'Chain+', desc: '+1 chain target', icon: '⚡+', stack: 0, max: 3, requires: 'weapon_chain', apply(g) { let w = g.player.weapons.find(w=>w.type==='chain'); if(w) w.chains++; } },
  { id: 'meteor_up', name: 'Meteor+', desc: '+40% blast radius & damage', icon: '☄️+', stack: 0, max: 3, requires: 'weapon_meteor', apply(g) { let w = g.player.weapons.find(w=>w.type==='meteor'); if(w){w.blastRadius*=1.4;w.damage*=1.4;} } },
  { id: 'shield_up', name: 'Barrier+', desc: '+25% radius & knockback', icon: '🛡️+', stack: 0, max: 3, requires: 'weapon_shield', apply(g) { let w = g.player.weapons.find(w=>w.type==='shield'); if(w){w.radius*=1.25;w.knockback*=1.25;} } },
  { id: 'lightning_field_up', name: 'Field+', desc: '+1 zap target & +20% radius', icon: '⚡+', stack: 0, max: 3, requires: 'weapon_lightning_field', apply(g) { let w = g.player.weapons.find(w=>w.type==='lightning_field'); if(w){w.zapCount++;w.radius*=1.2;} } },
  // EVOLUTION: max spit (4 stacks) + max breath (4 stacks) = Dragon Storm
  { id: 'evo_dragon_storm', name: 'DRAGON STORM', desc: 'Spit + Breath fuse into homing fireballs + damage aura', icon: '🐉',
    stack: 0, max: 1,
    get hidden() {
      const spit = POWERUPS.find(p=>p.id==='spit_up');
      const breath = POWERUPS.find(p=>p.id==='breath_up');
      return !(spit && spit.stack >= 3 && breath && breath.stack >= 3);
    },
    apply(g) {
      // remove spit and breath, add dragon storm weapon
      g.player.weapons = g.player.weapons.filter(w => w.type !== 'spit' && w.type !== 'breath');
      g.player.weapons.push(createWeapon('dragon_storm'));
      g.screenShake = 0.5;
      spawnParticles(g.player.x, g.player.y, '#f39c12', 20);
    }
  },
];

// --- init game ---
function initGame() {
  // reset powerup stacks
  POWERUPS.forEach(p => p.stack = 0);

  const p = {
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    vx: 0, vy: 0,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    radius: PLAYER_RADIUS,
    speed: PLAYER_SPEED,
    damageMulti: 1,
    attackSpeedMulti: 1,
    hpRegen: 0,
    magnetRange: XP_MAGNET_RANGE,
    xp: 0,
    xpToLevel: 45,
    level: 1,
    weapons: [createWeapon(selectedWeapon)], // start with chosen weapon
    alive: true,
    iframes: 0, // invincibility frames after hit
    facing: { x: 1, y: 0 },
  };

  // mark starting weapon as owned
  POWERUPS.find(p => p.id === 'weapon_' + selectedWeapon).stack = 1;

  return {
    player: p,
    enemies: [],
    projectiles: [],
    gems: [],
    heartDrops: [],
    particles: [],
    floatingTexts: [],
    time: 0,
    wave: 1,
    waveTimer: 0,
    waveDuration: 20, // seconds per wave (longer waves = more time to feel the pressure)
    spawnTimer: 0,
    spawnRate: 2.0, // seconds between spawn bursts (decreases per wave)
    specialWaveMsg: null,
    specialWaveMsgTimer: 0,
    waveMsg: '',
    waveMsgTimer: 0,
    kills: 0,
    playerName: 'you',
    deathFeed: [], // { text, time } — fading event log
    camera: { x: p.x, y: p.y },
    screenShake: 0,
    // Event queue drained by client each frame. Sim modules push typed
    // events here; client handles sfx/particles/HUD flashes from the
    // queue. See src/shared/sim/events.js for the EVT enum.
    events: [],
    rng: createRng(Date.now() & 0x7fffffff),
  };
}

// --- spawn enemy ---
function spawnEnemy(g) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 500 + Math.random() * 200;
  const ex = g.player.x + Math.cos(angle) * dist;
  const ey = g.player.y + Math.sin(angle) * dist;
  const e = enemyType(g.wave);
  e.x = Math.max(e.radius, Math.min(WORLD_W - e.radius, ex));
  e.y = Math.max(e.radius, Math.min(WORLD_H - e.radius, ey));
  e.hitFlash = 0;
  g.enemies.push(e);
}

// --- spawn gem ---
// spawnGem now imported from shared/sim/gems.js — call as spawnGem(g, x, y, xp)

// --- spawn heart pickup ---
function spawnHeart(x, y, heal) {
  game.heartDrops.push({ x, y, heal, radius: 8, life: 12, bobPhase: Math.random() * Math.PI * 2 });
}

// --- spawn particles ---
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 150;
    game.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.3 + Math.random() * 0.4,
      maxLife: 0.3 + Math.random() * 0.4,
      color,
      radius: 2 + Math.random() * 3,
    });
  }
}

// --- update ---
function update(dt) {
  if (!game || !game.player.alive || paused) return;
  const g = game;
  const p = g.player;

  g.time += dt;
  g.waveTimer += dt;

  // wave progression
  if (g.waveTimer >= g.waveDuration) {
    g.wave++;
    g.waveTimer = 0;
    g.deathFeed.push({ text: `${g.playerName} survived wave ${g.wave - 1}`, time: g.time });
    // spawn rate curve: fast early ramp, then gradual
    g.spawnRate = Math.max(0.25, 2.0 * Math.pow(0.88, g.wave - 1));
    // Show wave announcement for ALL waves
    g.waveMsg = `WAVE ${g.wave}`;
    g.waveMsgTimer = 2.0;
    // check for special wave
    const special = SPECIAL_WAVES[g.wave];
    if (special) {
      g.specialWaveMsg = special.name;
      g.specialWaveMsgTimer = 2.5;
    }
  }

  // wave message timers
  if (g.waveMsgTimer > 0) g.waveMsgTimer -= dt;
  if (g.specialWaveMsgTimer > 0) g.specialWaveMsgTimer -= dt;

  // spawn enemies — burst count scales with wave
  g.spawnTimer -= dt;
  if (g.spawnTimer <= 0) {
    const special = SPECIAL_WAVES[g.wave];
    let baseCount = 1 + Math.floor(g.wave / 2);
    if (special) baseCount = Math.ceil(baseCount * special.countMulti);
    const count = Math.min(baseCount, 12); // hard cap to prevent lag
    // cap total enemies on screen
    const maxEnemies = 80 + g.wave * 10;
    const toSpawn = Math.min(count, maxEnemies - g.enemies.length);
    for (let i = 0; i < toSpawn; i++) spawnEnemy(g);
    g.spawnTimer = g.spawnRate;
  }

  // player movement — analog touch input takes priority over digital keys
  let dx, dy;
  if (analogMove.x !== 0 || analogMove.y !== 0) {
    dx = analogMove.x;
    dy = analogMove.y;
  } else {
    dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  }
  if (dx || dy) p.facing = { x: dx, y: dy };
  p.x += dx * p.speed * dt;
  p.y += dy * p.speed * dt;
  p.x = Math.max(p.radius, Math.min(WORLD_W - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(WORLD_H - p.radius, p.y));

  // hp regen
  if (p.hpRegen > 0) {
    p.hp = Math.min(p.maxHp, p.hp + p.hpRegen * dt);
  }

  // iframes countdown
  if (p.iframes > 0) p.iframes -= dt;

  // --- weapons ---
  for (const w of p.weapons) {
    w.timer -= dt * p.attackSpeedMulti;
    if (w.timer <= 0) {
      w.timer = w.cooldown;
      fireWeapon(g, w);
    }
    // special: breath pulse phase
    if (w.type === 'breath') w.pulsePhase = (w.pulsePhase || 0) + dt * 3;
    // special: dragon storm aura pulse
    if (w.type === 'dragon_storm') w.pulsePhase = (w.pulsePhase || 0) + dt * 4;
    // special: charge active timer
    if (w.type === 'charge' && w.active) {
      w.chargeTimer -= dt;
      if (w.chargeTimer <= 0) {
        w.active = false;
      }
    }
    // special: orbit blade rotation (always active, no cooldown)
    if (w.type === 'orbit') {
      w.phase = (w.phase || 0) + w.rotSpeed * dt;
      // damage enemies touching blades
      for (let b = 0; b < w.bladeCount; b++) {
        const angle = w.phase + (b * Math.PI * 2 / w.bladeCount);
        const bx = p.x + Math.cos(angle) * w.radius;
        const by = p.y + Math.sin(angle) * w.radius;
        for (let j = g.enemies.length - 1; j >= 0; j--) {
          const e = g.enemies[j];
          const dx = bx - e.x;
          const dy = by - e.y;
          if (dx * dx + dy * dy < (10 + e.radius) ** 2) {
            damageEnemy(g, e, j, w.damage * p.damageMulti * dt * 8);
          }
        }
      }
    }
    // special: shield knockback + damage aura (always active)
    if (w.type === 'shield') {
      w.phase = (w.phase || 0) + dt * 4;
      let shieldHit = false;
      for (let j = g.enemies.length - 1; j >= 0; j--) {
        const e = g.enemies[j];
        const edx = e.x - p.x;
        const edy = e.y - p.y;
        const dist = Math.sqrt(edx * edx + edy * edy);
        if (dist < w.radius + e.radius && dist > 1) {
          shieldHit = true;
          // knockback
          const nx = edx / dist;
          const ny = edy / dist;
          e.x += nx * w.knockback * dt;
          e.y += ny * w.knockback * dt;
          // damage on contact
          damageEnemy(g, e, j, w.damage * p.damageMulti * dt * 2);
        }
      }
      // hum sfx throttled to once per 0.4s when actively pushing
      if (shieldHit) {
        w._humTimer = (w._humTimer || 0) - dt;
        if (w._humTimer <= 0) {
          sfx('shield_hum');
          w._humTimer = 0.4;
        }
      }
    }
    // special: lightning field — zaps N random enemies in range on each fire
    if (w.type === 'lightning_field' && w.timer >= w.cooldown - 0.01) {
      // just fired (timer was reset) — zap targets
      const inRange = [];
      for (const e of g.enemies) {
        const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (d2 < w.radius * w.radius) inRange.push(e);
      }
      // shuffle and pick zapCount targets
      for (let z = inRange.length - 1; z > 0; z--) {
        const r = Math.floor(Math.random() * (z + 1));
        [inRange[z], inRange[r]] = [inRange[r], inRange[z]];
      }
      const targets = inRange.slice(0, w.zapCount);
      g.chainEffects = g.chainEffects || [];
      for (const t of targets) {
        for (let j = g.enemies.length - 1; j >= 0; j--) {
          if (g.enemies[j] === t) {
            damageEnemy(g, g.enemies[j], j, w.damage * p.damageMulti);
            break;
          }
        }
        g.chainEffects.push({ points: [{ x: p.x, y: p.y }, { x: t.x, y: t.y }], life: 0.15, color: w.color });
      }
      if (targets.length > 0) sfx('zap');
    }
  }

  // --- update projectiles ---
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const proj = g.projectiles[i];
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    proj.dist += proj.speed * dt;

    // remove if out of range
    if (proj.dist > proj.range) {
      g.projectiles.splice(i, 1);
      continue;
    }

    // hit enemies
    for (let j = g.enemies.length - 1; j >= 0; j--) {
      const e = g.enemies[j];
      const edx = proj.x - e.x;
      const edy = proj.y - e.y;
      if (edx * edx + edy * edy < (proj.radius + e.radius) ** 2) {
        damageEnemy(g, e, j, proj.damage * p.damageMulti);
        proj.pierce--;
        if (proj.pierce <= 0) {
          g.projectiles.splice(i, 1);
          break;
        }
      }
    }
  }

  // --- breath aura damage ---
  for (const w of p.weapons) {
    if (w.type === 'breath') {
      for (let j = g.enemies.length - 1; j >= 0; j--) {
        const e = g.enemies[j];
        const edx = p.x - e.x;
        const edy = p.y - e.y;
        const dist = Math.sqrt(edx * edx + edy * edy);
        if (dist < w.radius + e.radius) {
          damageEnemy(g, e, j, w.damage * p.damageMulti * dt);
        }
      }
    }
  }

  // --- charge sweep damage (rectangle along charge vector) ---
  for (const w of p.weapons) {
    if (w.type === 'charge' && w.active) {
      const cdx = w.chargeDx;
      const cdy = w.chargeDy;
      for (let j = g.enemies.length - 1; j >= 0; j--) {
        const e = g.enemies[j];
        const ex = e.x - p.x;
        const ey = e.y - p.y;
        // project onto charge direction (forward) and perpendicular (lateral)
        const forward = ex * cdx + ey * cdy;
        const lateral = Math.abs(ex * (-cdy) + ey * cdx);
        if (forward > -w.width && forward < w.speed * w.duration && lateral < w.width + e.radius) {
          damageEnemy(g, e, j, w.damage * p.damageMulti * dt * 3);
        }
      }
    }
  }

  // --- update enemies (movement + per-enemy work) ---
  // Cell size for spatial hash. Brute is largest at radius 24, so 50u keeps
  // any colliding pair within own cell + 1 neighbor.
  const HASH_CELL = 50;
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i];
    // dying animation — shrink and fade, then remove
    if (e.dying !== undefined) {
      e.dying -= dt;
      if (e.dying <= 0) {
        g.enemies.splice(i, 1);
      }
      continue; // skip movement, collision, damage while dying
    }
    // move toward player — ghosts orbit/flank
    const edx = p.x - e.x;
    const edy = p.y - e.y;
    const dist = Math.sqrt(edx * edx + edy * edy);
    if (dist > 1) {
      if (e.name === 'ghost') {
        // ghosts spiral inward — per-ghost orbit direction prevents kiting
        const nx = edx / dist;
        const ny = edy / dist;
        const sign = e.orbitSign || 1;
        const perpX = -ny * sign;
        const perpY = nx * sign;
        // closing at range, committed up close, drive-by prevented at melee
        const inward = dist > 100 ? 0.8 : dist > 30 ? 1.0 : 1.0;
        const orbit = dist > 100 ? 0.6 : dist > 30 ? 0.3 : 0.1;
        e.x += (nx * inward + perpX * orbit) * e.speed * dt;
        e.y += (ny * inward + perpY * orbit) * e.speed * dt;
      } else if (e.name === 'boss') {
        // boss: stalk slowly, then charge periodically
        if (e.chargeTimer === undefined) e.chargeTimer = 3 + Math.random() * 2;
        if (e.charging === undefined) e.charging = 0;
        if (e.charging > 0) {
          // charging — 3x speed burst toward locked direction
          e.x += e.chargeDx * e.speed * 3 * dt;
          e.y += e.chargeDy * e.speed * 3 * dt;
          e.charging -= dt;
        } else {
          // stalking — slow approach
          e.x += (edx / dist) * e.speed * 0.5 * dt;
          e.y += (edy / dist) * e.speed * 0.5 * dt;
          e.chargeTimer -= dt;
          // periodic footstep thud
          if (e.stepTimer === undefined) e.stepTimer = 0.8;
          e.stepTimer -= dt;
          if (e.stepTimer <= 0 && dist < 500) {
            sfx('boss_step');
            e.stepTimer = 0.7 + Math.random() * 0.3;
          }
          if (e.chargeTimer <= 0 && dist < 400) {
            // lock charge direction and go
            e.chargeDx = edx / dist;
            e.chargeDy = edy / dist;
            e.charging = 0.8; // 0.8s charge duration
            e.chargeTimer = 4 + Math.random() * 3; // 4-7s between charges
            spawnParticles(e.x, e.y, '#d63031', 12); // telegraph
            sfx('boss_telegraph');
          }
        }
      } else {
        e.x += (edx / dist) * e.speed * dt;
        e.y += (edy / dist) * e.speed * dt;
      }
    }

    // spawner AI — periodically birth swarm minions
    if (e.name === 'spawner' && e.spawnTimer !== undefined) {
      e.spawnTimer -= dt;
      if (e.spawnTimer <= 0) {
        e.spawnTimer = 3 + Math.random() * 2; // 3-5s between spawns
        const count = 3 + Math.floor(Math.random() * 3); // 3-5 swarmlings
        for (let s = 0; s < count; s++) {
          const sa = Math.random() * Math.PI * 2;
          const sr = 20 + Math.random() * 20;
          const base = ENEMY_TYPES.find(t => t.name === 'swarm');
          const minion = scaleEnemy(base, g.wave);
          minion.x = e.x + Math.cos(sa) * sr;
          minion.y = e.y + Math.sin(sa) * sr;
          minion.hitFlash = 0;
          g.enemies.push(minion);
        }
        spawnParticles(e.x, e.y, '#fdcb6e', 8); // hive burst effect
        sfx('hive_burst');
      }
    }

    // hit flash decay
    if (e.hitFlash > 0) e.hitFlash -= dt * 5;

    // damage player on contact
    if (dist < p.radius + e.radius && p.iframes <= 0) {
      p.hp -= e.damage;
      p.iframes = 0.5;
      g.screenShake = 0.15;
      spawnParticles(p.x, p.y, '#e74c3c', 5);
      sfx('playerhit');
      if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
        sfx('death');
        g.deathFeed.push({ text: `${g.playerName} killed by ${e.name}`, time: g.time });
        showDeathScreen(g);
      }
    }
  }

  // --- enemy-enemy repulsion via spatial hash ---
  // Bucket enemies into cells, then each enemy only checks 9 cells (own +
  // neighbors) instead of all N. Drops cost from O(N²) to ~O(N) at the
  // typical low-density per-cell counts.
  const cells = new Map();
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    const cx = Math.floor(e.x / HASH_CELL);
    const cy = Math.floor(e.y / HASH_CELL);
    const k = cx * 100000 + cy; // numeric key avoids string interning
    let bucket = cells.get(k);
    if (!bucket) { bucket = []; cells.set(k, bucket); }
    bucket.push(i);
  }
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    const cx = Math.floor(e.x / HASH_CELL);
    const cy = Math.floor(e.y / HASH_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = cells.get((cx + dx) * 100000 + (cy + dy));
        if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const j = bucket[bi];
          if (j <= i) continue; // each pair handled once
          const e2 = g.enemies[j];
          const rx = e.x - e2.x;
          const ry = e.y - e2.y;
          const rd = Math.sqrt(rx * rx + ry * ry);
          const minD = e.radius + e2.radius;
          if (rd < minD && rd > 0.1) {
            const push = (minD - rd) * 0.5;
            const nx = rx / rd;
            const ny = ry / rd;
            e.x += nx * push;
            e.y += ny * push;
            e2.x -= nx * push;
            e2.y -= ny * push;
          }
        }
      }
    }
  }

  // --- pick up gems --- (sim logic in shared/sim/gems.js, side effects via events)
  updateGems(g, dt);

  // --- pick up hearts ---
  for (let i = g.heartDrops.length - 1; i >= 0; i--) {
    const h = g.heartDrops[i];
    h.life -= dt;
    h.bobPhase += dt * 3;
    if (h.life <= 0) { g.heartDrops.splice(i, 1); continue; }
    const hdx = p.x - h.x;
    const hdy = p.y - h.y;
    const dist = Math.sqrt(hdx * hdx + hdy * hdy);
    // gentle magnet pull when close
    if (dist < p.magnetRange * 0.6) {
      const pull = XP_MAGNET_SPEED * 0.7 * dt;
      h.x += (hdx / dist) * Math.min(pull, dist);
      h.y += (hdy / dist) * Math.min(pull, dist);
    }
    if (dist < p.radius + h.radius) {
      const healed = Math.min(h.heal, p.maxHp - p.hp);
      p.hp = Math.min(p.maxHp, p.hp + h.heal);
      sfx('heal');
      if (healed > 0) {
        g.floatingTexts.push({
          x: h.x, y: h.y, text: '+' + Math.floor(healed) + ' HP',
          color: '#2ecc71', life: 0.8, maxLife: 0.8, vy: -50,
        });
      }
      spawnParticles(h.x, h.y, '#e74c3c', 4);
      g.heartDrops.splice(i, 1);
    }
  }

  // --- update particles ---
  for (let i = g.particles.length - 1; i >= 0; i--) {
    const pt = g.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) g.particles.splice(i, 1);
  }

  // --- update floating texts ---
  for (let i = g.floatingTexts.length - 1; i >= 0; i--) {
    const ft = g.floatingTexts[i];
    ft.y += ft.vy * dt;
    ft.life -= dt;
    if (ft.life <= 0) g.floatingTexts.splice(i, 1);
  }

  // --- update chain effects ---
  g.chainEffects = g.chainEffects || [];
  for (let i = g.chainEffects.length - 1; i >= 0; i--) {
    g.chainEffects[i].life -= dt;
    if (g.chainEffects[i].life <= 0) g.chainEffects.splice(i, 1);
  }

  // --- update meteor effects ---
  g.meteorEffects = g.meteorEffects || [];
  for (let i = g.meteorEffects.length - 1; i >= 0; i--) {
    const m = g.meteorEffects[i];
    m.life -= dt;
    if (m.phase === 'warn' && m.life <= 0) {
      // explode — damage enemies in radius
      m.phase = 'explode';
      m.life = 0.3;
      g.screenShake = 0.1;
      sfx('meteor');
      for (let j = g.enemies.length - 1; j >= 0; j--) {
        const e = g.enemies[j];
        const dx = m.x - e.x;
        const dy = m.y - e.y;
        if (dx * dx + dy * dy < (m.radius + e.radius) ** 2) {
          damageEnemy(g, g.enemies[j], j, m.damage);
        }
      }
      spawnParticles(m.x, m.y, m.color, 12);
    } else if (m.phase === 'explode' && m.life <= 0) {
      g.meteorEffects.splice(i, 1);
    }
  }

  // --- dragon storm aura damage ---
  for (const w of p.weapons) {
    if (w.type === 'dragon_storm') {
      for (let j = g.enemies.length - 1; j >= 0; j--) {
        const e = g.enemies[j];
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        if (dx * dx + dy * dy < (w.auraRadius + e.radius) ** 2) {
          damageEnemy(g, e, j, w.auraDamage * p.damageMulti * dt);
        }
      }
    }
  }

  // --- camera ---
  // Frame-rate independent exponential smoothing: ~7 units/sec decay rate
  // Using fixed-rate lerp avoids variable-dt judder on mobile
  const camLerp = 1 - Math.exp(-12 * dt);
  g.camera.x += (p.x - g.camera.x) * camLerp;
  g.camera.y += (p.y - g.camera.y) * camLerp;

  // screen shake decay
  if (g.screenShake > 0) g.screenShake -= dt;
  if (g.levelFlash > 0) g.levelFlash -= dt;

  // --- update XP bar (only when bucket changes — avoids triggering layout
  // every single frame on a value that changes ~5x/sec at most)
  const xpPct = Math.round(p.xp / p.xpToLevel * 1000);
  if (xpPct !== hudCache.xpPct) {
    hudEl.xpFill.style.width = (xpPct / 10) + '%';
    hudCache.xpPct = xpPct;
  }

  // Drain sim event queue. Sim modules push events here (sfx, particle
  // spawns, screen shake triggers); client decides what to do. Empty
  // until PR #12 starts emitting from extracted sim code.
  if (g.events.length > 0) {
    for (const evt of g.events) handleSimEvent(evt);
    g.events.length = 0;
  }
}

// Handle a single event from the sim. Sim is forbidden from touching
// DOM/canvas/audio directly — it emits events into g.events, client
// side-effects happen here. New sim subsystems plug in by adding cases.
function handleSimEvent(evt) {
  const g = game;
  if (!g) return;
  switch (evt.type) {
    case EVT.GEM_PICKUP:
      sfx('xp');
      g.floatingTexts.push({
        x: evt.x, y: evt.y, text: '+' + evt.xp,
        color: '#3498db', life: 0.8, maxLife: 0.8, vy: -60,
      });
      spawnParticles(evt.x, evt.y, '#3498db', 3);
      break;
    case EVT.LEVEL_UP:
      g.levelFlash = 0.15; // 150ms flash
      showLevelUp(g);
      break;
  }
}

function fireWeapon(g, w) {
  const p = g.player;
  if (w.type === 'spit') {
    // find nearest enemy
    let nearest = null;
    let nearestDist = w.range;
    for (const e of g.enemies) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) { nearest = e; nearestDist = d; }
    }
    if (!nearest) return;
    sfx('spit');

    const dx = nearest.x - p.x;
    const dy = nearest.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / d;
    const ny = dy / d;

    for (let i = 0; i < w.count; i++) {
      // slight spread for multiple projectiles
      const spread = w.count > 1 ? (i - (w.count - 1) / 2) * 0.15 : 0;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const fx = nx * cos - ny * sin;
      const fy = nx * sin + ny * cos;

      g.projectiles.push({
        x: p.x + fx * 20,
        y: p.y + fy * 20,
        vx: fx * w.speed,
        vy: fy * w.speed,
        speed: w.speed,
        damage: w.damage,
        range: w.range,
        dist: 0,
        pierce: w.pierce,
        radius: 5,
        color: w.color,
      });
    }
  } else if (w.type === 'charge') {
    // charge in facing direction
    const f = p.facing;
    const d = Math.sqrt(f.x * f.x + f.y * f.y);
    if (d > 0.01) {
      w.active = true;
      w.chargeTimer = w.duration;
      w.chargeDx = f.x / d;
      w.chargeDy = f.y / d;
      // boost player position in charge direction
      p.x += w.chargeDx * w.speed * w.duration;
      p.y += w.chargeDy * w.speed * w.duration;
      p.x = Math.max(p.radius, Math.min(WORLD_W - p.radius, p.x));
      p.y = Math.max(p.radius, Math.min(WORLD_H - p.radius, p.y));
      g.screenShake = 0.1;
      sfx('charge');
      spawnParticles(p.x, p.y, w.color, 8);
    }
  } else if (w.type === 'chain') {
    // chain lightning — zap nearest, chain to N more
    if (g.enemies.length === 0) return;
    sfx('chain');
    // find nearest
    let sorted = g.enemies.slice().sort((a, b) => {
      const da = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
      const db = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
      return da - db;
    });
    const inRange = sorted.filter(e => {
      const d = Math.sqrt((e.x - p.x) ** 2 + (e.y - p.y) ** 2);
      return d < w.range;
    });
    if (inRange.length === 0) return;
    const targets = [inRange[0]];
    const hit = new Set([inRange[0]]);
    for (let c = 0; c < w.chains && targets.length > 0; c++) {
      const last = targets[targets.length - 1];
      let best = null, bestDist = w.chainRange;
      for (const e of g.enemies) {
        if (hit.has(e)) continue;
        const d = Math.sqrt((e.x - last.x) ** 2 + (e.y - last.y) ** 2);
        if (d < bestDist) { best = e; bestDist = d; }
      }
      if (best) { targets.push(best); hit.add(best); }
    }
    // store chain for rendering
    g.chainEffects = g.chainEffects || [];
    const chainPoints = [{ x: p.x, y: p.y }];
    for (const t of targets) {
      chainPoints.push({ x: t.x, y: t.y });
      for (let j = g.enemies.length - 1; j >= 0; j--) {
        if (g.enemies[j] === t) {
          damageEnemy(g, g.enemies[j], j, w.damage * p.damageMulti);
          break;
        }
      }
    }
    g.chainEffects.push({ points: chainPoints, life: 0.2, color: w.color });
  } else if (w.type === 'meteor') {
    // meteor — drop AoE on densest cluster
    if (g.enemies.length === 0) return;
    // pick random enemy as target center
    const target = g.enemies[Math.floor(Math.random() * g.enemies.length)];
    // create meteor effect
    g.meteorEffects = g.meteorEffects || [];
    g.meteorEffects.push({
      x: target.x, y: target.y,
      radius: w.blastRadius,
      damage: w.damage * p.damageMulti,
      life: 0.5,    // warning phase
      phase: 'warn',
      color: w.color,
    });
  } else if (w.type === 'dragon_storm') {
    // homing fireballs in spread pattern
    if (g.enemies.length === 0) return;
    w._fireCount = (w._fireCount || 0) + 1;
    if (w._fireCount % 3 === 1) sfx('dragonstorm');
    let nearest = null, nearestDist = w.range;
    for (const e of g.enemies) {
      const d = Math.sqrt((e.x - p.x) ** 2 + (e.y - p.y) ** 2);
      if (d < nearestDist) { nearest = e; nearestDist = d; }
    }
    if (!nearest) return;
    const dx = nearest.x - p.x;
    const dy = nearest.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    for (let i = 0; i < w.count; i++) {
      const spread = (i - (w.count - 1) / 2) * 0.2;
      const cos = Math.cos(spread), sin = Math.sin(spread);
      const fx = (dx/d) * cos - (dy/d) * sin;
      const fy = (dx/d) * sin + (dy/d) * cos;
      g.projectiles.push({
        x: p.x + fx * 20, y: p.y + fy * 20,
        vx: fx * w.speed, vy: fy * w.speed,
        speed: w.speed, damage: w.damage, range: w.range,
        dist: 0, pierce: w.pierce, radius: 7, color: w.color,
      });
    }
  }
  // breath and orbit don't fire — they're always-on
}

function damageEnemy(g, e, idx, dmg) {
  if (e.dying) return; // already dead, skip
  e.hp -= dmg;
  e.hitFlash = 1;
  // damage number (only show for hits > 5 to avoid spam from breath ticks)
  if (dmg >= 5) {
    sfx('hit');
    g.floatingTexts.push({
      x: e.x + (Math.random() - 0.5) * 10,
      y: e.y - e.radius - 4,
      text: Math.floor(dmg).toString(),
      color: '#f1c40f', life: 0.5, maxLife: 0.5, vy: -40,
    });
  }
  if (e.hp <= 0 && !e.dying) {
    sfx('kill');
    spawnGem(g, e.x, e.y, e.xp);
    // heart drop — wave 6+, 8% chance, higher for tougher enemies
    if (g.wave >= 6 && Math.random() < (e.name === 'boss' ? 1.0 : e.name === 'elite' || e.name === 'brute' ? 0.2 : 0.08)) {
      spawnHeart(e.x, e.y, 15);
    }
    spawnParticles(e.x, e.y, e.color, 6);
    e.dying = 0.2; // 200ms death animation
    g.kills++;
  }
}

// --- level up UI ---
function showLevelUp(g) {
  sfx('levelup');
  paused = true;
  const available = POWERUPS.filter(p => {
    if (p.stack >= p.max) return false;
    if (p.hidden) return false;
    if (p.requires) {
      const req = POWERUPS.find(r => r.id === p.requires);
      if (!req || req.stack === 0) return false;
    }
    return true;
  });

  // pick 3 random
  const shuffled = available.sort(() => Math.random() - 0.5);
  const choices = shuffled.slice(0, 3);

  const container = document.getElementById('level-choices');
  container.innerHTML = '';
  document.getElementById('level-up').style.display = 'flex';

  // store choices globally for keyboard selection
  window._levelChoices = [];
  for (let ci = 0; ci < choices.length; ci++) {
    const choice = choices[ci];
    const div = document.createElement('div');
    div.className = 'choice';
    div.innerHTML = `
      <div class="name"><span style="color:#555;font-size:0.6rem">[${ci+1}]</span> ${choice.icon} ${choice.name}</div>
      <div class="desc">${choice.desc}</div>
    `;
    const pick = () => {
      choice.stack++;
      choice.apply(g);
      document.getElementById('level-up').style.display = 'none';
      paused = false;
      window._levelChoices = [];
    };
    div.onclick = pick;
    window._levelChoices.push(pick);
    container.appendChild(div);
  }

  // if no choices available, just unpause
  if (choices.length === 0) {
    document.getElementById('level-up').style.display = 'none';
    paused = false;
  }
}

function getBestRun() {
  try {
    const raw = localStorage.getItem('survivors_best');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveBestRun(run) {
  try { localStorage.setItem('survivors_best', JSON.stringify(run)); } catch (e) { /* ok */ }
}

function showDeathScreen(g) {
  fadeOutMusic();
  track({ type: 'death', wave: g.wave, kills: g.kills, weapons: g.player.weapons.map(w => w.type) });
  const mins = Math.floor(g.time / 60);
  const secs = Math.floor(g.time % 60);
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
  const weaponList = g.player.weapons.map(w => WEAPON_ICONS[w.type] || '?').join(' ');
  const powerupList = POWERUPS.filter(p => p.stack > 0 && !p.id.startsWith('weapon_'))
    .map(p => `${p.icon}×${p.stack}`).join(' ');

  // current run stats
  const thisRun = { wave: g.wave, kills: g.kills, time: g.time, level: g.player.level };

  // check for new best (compare by wave first, then kills as tiebreaker)
  const prev = getBestRun();
  let isNewBest = false;
  if (!prev || thisRun.wave > prev.wave || (thisRun.wave === prev.wave && thisRun.kills > prev.kills)) {
    isNewBest = true;
    saveBestRun(thisRun);
  }
  const best = isNewBest ? thisRun : prev;

  // new best flash
  const newBestEl = document.getElementById('death-new-best');
  newBestEl.innerHTML = isNewBest ? '<div class="new-best">★ NEW BEST ★</div>' : '';

  // stats
  document.getElementById('death-stats').innerHTML = `
    Survived: ${timeStr}<br>
    Level: ${g.player.level} · Wave: ${g.wave}<br>
    Kills: ${g.kills}<br>
    <div style="margin-top:8px;font-size:0.7rem;color:#666">Weapons: ${weaponList}</div>
    ${powerupList ? `<div style="font-size:0.65rem;color:#555">Powerups: ${powerupList}</div>` : ''}
  `;

  // best run display
  const bestMins = Math.floor(best.time / 60);
  const bestSecs = Math.floor(best.time % 60);
  document.getElementById('death-best-run').innerHTML = `
    <div class="best-label">best run</div>
    <div class="best-value">Wave ${best.wave} · ${best.kills} kills · ${bestMins}:${bestSecs.toString().padStart(2, '0')}</div>
  `;

  // build loadout display from owned powerups
  const loadoutEl = document.getElementById('death-loadout');
  const owned = POWERUPS.filter(p => p.stack > 0);
  if (owned.length > 0) {
    loadoutEl.innerHTML = owned.map(p => {
      const stackStr = p.stack > 1 ? ` ×${p.stack}` : '';
      return `<div class="loadout-item"><span class="li-icon">${p.icon}</span>${p.name}${stackStr}</div>`;
    }).join('');
  } else {
    loadoutEl.innerHTML = '<div class="loadout-item" style="color:#555">no powerups</div>';
  }
  document.getElementById('death-screen').style.display = 'flex';
}

// --- render ---
function render() {
  const W = canvas.width;
  const H = canvas.height;
  const g = game;
  if (!g) return;

  ctx.save();
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  // camera transform — snap to integer pixels to prevent sub-pixel shimmer on mobile
  let cx = g.camera.x - W / 2;
  let cy = g.camera.y - H / 2;

  // screen shake
  if (g.screenShake > 0) {
    cx += (Math.random() - 0.5) * 8;
    cy += (Math.random() - 0.5) * 8;
  }

  cx = Math.round(cx);
  cy = Math.round(cy);

  ctx.translate(-cx, -cy);

  // --- background grid ---
  const gridSize = 60;
  const startX = Math.floor(cx / gridSize) * gridSize;
  const startY = Math.floor(cy / gridSize) * gridSize;
  ctx.strokeStyle = '#12121a';
  ctx.lineWidth = 1;
  for (let x = startX; x < cx + W + gridSize; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, cy + H); ctx.stroke();
  }
  for (let y = startY; y < cy + H + gridSize; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx + W, y); ctx.stroke();
  }

  // --- world border ---
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

  // --- gems (sprites) ---
  for (const gem of g.gems) {
    if (!drawSprite('gem', gem.x, gem.y, 0.9, 0.85)) {
      ctx.fillStyle = '#3498db';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(gem.x, gem.y - gem.radius);
      ctx.lineTo(gem.x + gem.radius, gem.y);
      ctx.lineTo(gem.x, gem.y + gem.radius);
      ctx.lineTo(gem.x - gem.radius, gem.y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // --- heart pickups (sprites with bob) ---
  for (const h of g.heartDrops) {
    const bob = Math.sin(h.bobPhase) * 3;
    const fadeAlpha = h.life < 3 ? h.life / 3 : 1; // fade out last 3 seconds
    ctx.globalAlpha = fadeAlpha;
    if (!drawSprite('heart', h.x, h.y + bob, 0.8, fadeAlpha)) {
      // fallback — draw a simple heart shape
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(h.x - 4, h.y + bob - 2, 5, 0, Math.PI * 2);
      ctx.arc(h.x + 4, h.y + bob - 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(h.x - 9, h.y + bob);
      ctx.lineTo(h.x, h.y + bob + 8);
      ctx.lineTo(h.x + 9, h.y + bob);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- breath aura ---
  const p = g.player;
  for (const w of p.weapons) {
    if (w.type === 'breath') {
      const pulse = 1 + Math.sin(w.pulsePhase) * 0.1;
      const r = w.radius * pulse;
      const grad = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r);
      grad.addColorStop(0, 'rgba(230, 126, 34, 0.15)');
      grad.addColorStop(0.7, 'rgba(230, 126, 34, 0.08)');
      grad.addColorStop(1, 'rgba(230, 126, 34, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      // ring
      ctx.strokeStyle = 'rgba(230, 126, 34, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();

      // rotating particles on the ring edge
      const numDots = 8;
      const phase = w.pulsePhase * 0.7;
      for (let i = 0; i < numDots; i++) {
        const a = phase + (Math.PI * 2 / numDots) * i;
        const dotR = 3 + Math.sin(w.pulsePhase * 2 + i) * 1.5;
        ctx.globalAlpha = 0.6 + Math.sin(w.pulsePhase + i * 0.8) * 0.3;
        ctx.fillStyle = '#e67e22';
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // dragon storm aura
    if (w.type === 'dragon_storm') {
      const pulse = 1 + Math.sin((w.pulsePhase || 0)) * 0.1;
      const r = w.auraRadius * pulse;
      const grad = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
      grad.addColorStop(0, 'rgba(243, 156, 18, 0.2)');
      grad.addColorStop(0.6, 'rgba(231, 76, 60, 0.1)');
      grad.addColorStop(1, 'rgba(231, 76, 60, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(243, 156, 18, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // orbit blades
    if (w.type === 'orbit') {
      for (let b = 0; b < w.bladeCount; b++) {
        const angle = (w.phase || 0) + (b * Math.PI * 2 / w.bladeCount);
        const bx = p.x + Math.cos(angle) * w.radius;
        const by = p.y + Math.sin(angle) * w.radius;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(angle + Math.PI / 2);
        ctx.fillStyle = w.color;
        ctx.shadowColor = w.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(4, 4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    }

    // shield barrier
    if (w.type === 'shield') {
      const pulse = 1 + Math.sin(w.phase) * 0.08;
      const r = w.radius * pulse;
      const grad = ctx.createRadialGradient(p.x, p.y, r * 0.7, p.x, p.y, r);
      grad.addColorStop(0, 'rgba(116, 185, 255, 0)');
      grad.addColorStop(0.8, 'rgba(116, 185, 255, 0.12)');
      grad.addColorStop(1, 'rgba(116, 185, 255, 0.25)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      // shield ring
      ctx.strokeStyle = 'rgba(116, 185, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // hexagonal pattern dots on ring
      const hexCount = 6;
      for (let h = 0; h < hexCount; h++) {
        const a = w.phase * 0.5 + (Math.PI * 2 / hexCount) * h;
        ctx.fillStyle = 'rgba(116, 185, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // lightning field radius indicator
    if (w.type === 'lightning_field') {
      ctx.strokeStyle = 'rgba(255, 234, 167, 0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, w.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // --- chain lightning effects ---
  for (const ce of (g.chainEffects || [])) {
    ctx.strokeStyle = ce.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = ce.color;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = ce.life / 0.2;
    for (let i = 0; i < ce.points.length - 1; i++) {
      const a = ce.points[i];
      const b = ce.points[i + 1];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      // jagged lightning
      const mx = (a.x + b.x) / 2 + (Math.random() - 0.5) * 20;
      const my = (a.y + b.y) / 2 + (Math.random() - 0.5) * 20;
      ctx.lineTo(mx, my);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  // --- meteor effects ---
  for (const m of (g.meteorEffects || [])) {
    if (m.phase === 'warn') {
      ctx.strokeStyle = 'rgba(255, 99, 72, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // pulsing center
      ctx.fillStyle = `rgba(255, 99, 72, ${0.1 + Math.sin(m.life * 20) * 0.1})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // explosion
      const t = m.life / 0.3;
      ctx.fillStyle = `rgba(255, 99, 72, ${t * 0.4})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius * (2 - t), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- enemies (sprites with shape fallback) ---
  for (const e of g.enemies) {
    // skip if off screen
    if (e.x < cx - 50 || e.x > cx + W + 50 || e.y < cy - 50 || e.y > cy + H + 50) continue;

    // death animation — shrink + fade
    if (e.dying !== undefined) {
      const t = e.dying / 0.2; // 1.0 → 0.0 over 200ms
      const dyingScale = (0.3 + t * 0.7) * (e.radius / 8); // fold shrink into final scale
      const spriteName = e.sprite || 'blob';
      // single drawImage with alpha — no save/translate/scale/restore
      if (!drawSprite(spriteName, e.x, e.y, dyingScale, t)) {
        const prev = ctx.globalAlpha;
        ctx.globalAlpha = t;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius * (0.3 + t * 0.7), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = prev;
      }
      continue; // skip normal render + hp bar
    }

    const spriteScale = e.radius / 8; // scale sprite to match enemy radius
    const spriteName = e.sprite || 'blob';

    if (e.hitFlash > 0) {
      // draw sprite then overlay white flash circle
      if (!drawSprite(spriteName, e.x, e.y, spriteScale)) {
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(255,255,255,${Math.min(e.hitFlash * 5, 0.6)})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 0.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (!drawSprite(spriteName, e.x, e.y, spriteScale)) {
      // fallback to colored circle if sprites not loaded
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // hp bar
    if (e.hp < e.maxHp) {
      const bw = e.radius * 2;
      ctx.fillStyle = '#300';
      ctx.fillRect(e.x - bw / 2, e.y - e.radius - 8, bw, 3);
      ctx.fillStyle = e.hp / e.maxHp > 0.3 ? '#2ecc71' : '#e74c3c';
      ctx.fillRect(e.x - bw / 2, e.y - e.radius - 8, bw * (e.hp / e.maxHp), 3);
    }
  }

  // --- projectiles (sprites with trail) ---
  for (const proj of g.projectiles) {
    // trail sprites
    const trailLen = 4;
    const speed = Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);
    if (speed > 0) {
      const nx = -proj.vx / speed;
      const ny = -proj.vy / speed;
      for (let t = 1; t <= trailLen; t++) {
        const alpha = 0.3 - t * 0.06;
        const tScale = (1 - t * 0.15) * 0.7;
        if (!drawSprite('spitTrail', proj.x + nx * t * 6, proj.y + ny * t * 6, tScale, alpha)) {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = proj.color;
          ctx.beginPath();
          ctx.arc(proj.x + nx * t * 6, proj.y + ny * t * 6, proj.radius * (1 - t * 0.15), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    // main projectile sprite
    ctx.shadowColor = proj.color;
    ctx.shadowBlur = 10;
    if (!drawSprite('spit', proj.x, proj.y, 0.7)) {
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // --- charge effect (streak along charge vector) ---
  for (const w of p.weapons) {
    if (w.type === 'charge' && w.active) {
      const trailDist = w.speed * w.duration;
      const progress = 1 - (w.chargeTimer / w.duration); // 0→1 over charge
      // perpendicular vector for slash width
      const perpX = -w.chargeDy;
      const perpY = w.chargeDx;

      // main dash trail — tapered streak
      ctx.save();
      const steps = 10;
      for (let t = steps; t >= 0; t--) {
        const frac = t / steps;
        const tx = p.x - w.chargeDx * trailDist * frac;
        const ty = p.y - w.chargeDy * trailDist * frac;
        const alpha = 0.35 * (1 - frac);
        const size = w.width * (1 - frac * 0.6);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = w.color;
        ctx.beginPath();
        ctx.arc(tx, ty, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // speed lines — short streaks along the charge path
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const offset = (i + 1) * 0.2;
        const spread = (i % 2 === 0 ? 1 : -1) * (8 + i * 6);
        const sx = p.x - w.chargeDx * trailDist * offset + perpX * spread;
        const sy = p.y - w.chargeDy * trailDist * offset + perpY * spread;
        const lineLen = 12 + i * 4;
        ctx.globalAlpha = 0.4 * (1 - offset);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - w.chargeDx * lineLen, sy - w.chargeDy * lineLen);
        ctx.stroke();
      }

      // impact slash arc at player position
      ctx.globalAlpha = 0.5 * (1 - progress);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      const slashAngle = Math.atan2(w.chargeDy, w.chargeDx);
      ctx.beginPath();
      ctx.arc(p.x, p.y, w.width * 1.5, slashAngle - 0.8, slashAngle + 0.8);
      ctx.stroke();

      ctx.restore();
    }
  }

  // --- player ---
  if (p.alive) {
    // iframe flicker
    const flickerHide = p.iframes > 0 && Math.floor(p.iframes * 10) % 2;
    const playerAlpha = flickerHide ? 0.4 : 1.0;

    // glow
    ctx.shadowColor = p.iframes > 0 ? '#fff' : '#3498db';
    ctx.shadowBlur = 15;

    // player sprite
    if (!drawSprite('player', p.x, p.y, 2, playerAlpha)) {
      // fallback circle
      ctx.fillStyle = flickerHide ? 'rgba(255,255,255,0.5)' : '#eee';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // facing indicator (little triangle pointing in move direction)
    const fd = Math.sqrt(p.facing.x ** 2 + p.facing.y ** 2);
    if (fd > 0.01) {
      const fx = p.facing.x / fd;
      const fy = p.facing.y / fd;
      const tipX = p.x + fx * (p.radius + 6);
      const tipY = p.y + fy * (p.radius + 6);
      const perpX = -fy;
      const perpY = fx;
      ctx.fillStyle = '#3498db';
      ctx.globalAlpha = playerAlpha;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(p.x + fx * p.radius - perpX * 4, p.y + fy * p.radius - perpY * 4);
      ctx.lineTo(p.x + fx * p.radius + perpX * 4, p.y + fy * p.radius + perpY * 4);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // name tag above player
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.8;
    ctx.fillText(g.playerName, p.x, p.y - p.radius - 16);
    ctx.globalAlpha = 1;

    // hp bar above player (always visible for MP readability)
    const bw = 30;
    ctx.fillStyle = '#222';
    ctx.fillRect(p.x - bw / 2, p.y - p.radius - 10, bw, 4);
    ctx.fillStyle = p.hp / p.maxHp > 0.3 ? '#2ecc71' : '#e74c3c';
    ctx.fillRect(p.x - bw / 2, p.y - p.radius - 10, bw * (p.hp / p.maxHp), 4);
  }

  // --- particles ---
  for (const pt of g.particles) {
    ctx.globalAlpha = pt.life / pt.maxLife;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.radius * (pt.life / pt.maxLife), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // --- floating texts ---
  for (const ft of g.floatingTexts) {
    ctx.globalAlpha = ft.life / ft.maxLife;
    ctx.fillStyle = ft.color;
    ctx.font = 'bold 12px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // --- wave announcement banner ---
  if (g.waveMsgTimer > 0) {
    const alpha = Math.min(1, g.waveMsgTimer / 0.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 28px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#f39c12';
    ctx.shadowBlur = 15;
    ctx.fillText(g.waveMsg, W / 2, H * 0.3);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // --- special wave announcement (below wave number) ---
  if (g.specialWaveMsgTimer > 0) {
    const alpha = Math.min(1, g.specialWaveMsgTimer / 0.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#e74c3c';
    ctx.font = 'bold 36px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#e74c3c';
    ctx.shadowBlur = 20;
    ctx.fillText(`⚠ ${g.specialWaveMsg} ⚠`, W / 2, H * 0.3 + 44);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // --- death feed (bottom-left, fading) ---
  const feedMax = 5;
  const feedDuration = 6; // seconds visible
  const recentFeed = g.deathFeed.slice(-feedMax);
  for (let i = 0; i < recentFeed.length; i++) {
    const entry = recentFeed[i];
    const age = g.time - entry.time;
    if (age > feedDuration) continue;
    const alpha = age > feedDuration - 1 ? (feedDuration - age) : 1;
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.fillStyle = '#ccc';
    ctx.font = '10px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(entry.text, 12, H - 20 - (recentFeed.length - 1 - i) * 16);
    ctx.restore();
  }

  // --- HUD ---
  // setHud only writes to DOM when the value changed — saves ~300
  // unnecessary writes/sec at 60fps. Free frames on mobile.
  const mins = Math.floor(g.time / 60);
  const secs = Math.floor(g.time % 60);
  setHud('time',    `${mins}:${secs.toString().padStart(2, '0')}`);
  setHud('level',   `Lv ${p.level}`);
  setHud('kills',   `${g.kills} kills`);
  setHud('wave',    `Wave ${g.wave}`);
  setHud('weapons', p.weapons.map(w => WEAPON_ICONS[w.type] || '?').join(' '));

  // --- level-up flash ---
  if (g.levelFlash > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform for full-screen overlay
    ctx.globalAlpha = g.levelFlash / 0.15 * 0.3; // fade from 0.3 to 0
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

}

// --- input ---
const KEY_MAP = {
  'w': 'up', 'arrowup': 'up',
  's': 'down', 'arrowdown': 'down',
  'a': 'left', 'arrowleft': 'left',
  'd': 'right', 'arrowright': 'right',
};

document.addEventListener('keydown', e => {
  // level-up keyboard shortcuts
  if (paused && window._levelChoices && window._levelChoices.length > 0) {
    const num = parseInt(e.key);
    if (num >= 1 && num <= window._levelChoices.length) {
      window._levelChoices[num - 1]();
      e.preventDefault();
      return;
    }
  }
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  const k = KEY_MAP[e.key.toLowerCase()];
  if (k) { keys[k] = true; e.preventDefault(); }
});

document.addEventListener('keyup', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  const k = KEY_MAP[e.key.toLowerCase()];
  if (k) { keys[k] = false; e.preventDefault(); }
});

// Clear all input on blur / tab hide. Without this, holding a key, alt-tabbing,
// and releasing it while the page is hidden leaves the key permanently "down"
// — player drifts forever after returning. Mobile home-button does the same.
function clearAllInput() {
  keys.up = keys.down = keys.left = keys.right = false;
  analogMove.x = 0;
  analogMove.y = 0;
}
window.addEventListener('blur', clearAllInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearAllInput(); });

// --- mobile invisible touch joystick ---
const joyZone = document.getElementById('joystick-zone');
const touchHint = document.getElementById('touch-hint');
let joyTouchId = null;
let joyOrigin = null;
let hintShown = false;
const JOY_DEAD = 15;

joyZone.addEventListener('touchstart', e => {
  if (joyTouchId !== null) return;
  const t = e.changedTouches[0];
  joyTouchId = t.identifier;
  joyOrigin = { x: t.clientX, y: t.clientY };
  // fade hint on first touch
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
      // analog: normalized direction vector, magnitude clamped to 1
      const mag = Math.min(dist / 60, 1); // 60px = full speed
      analogMove.x = (dx / dist) * mag;
      analogMove.y = (dy / dist) * mag;
      // keep boolean keys in sync for weapon aim logic
      keys.left = analogMove.x < -0.3;
      keys.right = analogMove.x > 0.3;
      keys.up = analogMove.y < -0.3;
      keys.down = analogMove.y > 0.3;
    } else {
      analogMove.x = analogMove.y = 0;
      keys.left = keys.right = keys.up = keys.down = false;
    }
  }
  e.preventDefault();
}, { passive: false });

function joyEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier !== joyTouchId) continue;
    joyTouchId = null;
    joyOrigin = null;
    analogMove.x = analogMove.y = 0;
    keys.left = keys.right = keys.up = keys.down = false;
  }
}
joyZone.addEventListener('touchend', joyEnd, { passive: false });
joyZone.addEventListener('touchcancel', joyEnd, { passive: false });

// prevent default touch behaviors on the whole page
document.addEventListener('touchmove', e => {
  if (e.target === canvas || e.target === joyZone || joyZone.contains(e.target)) {
    e.preventDefault();
  }
}, { passive: false });

// prevent double-tap zoom
let lastTap = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTap < 300) e.preventDefault();
  lastTap = now;
}, { passive: false });

// prevent context menu / long press
document.addEventListener('contextmenu', e => e.preventDefault());

// --- game loop (unified: update + render in single rAF to prevent camera/render desync) ---
let lastTime = 0;

function gameLoop(ts) {
  if (lastTime === 0) lastTime = ts; // prevent huge dt spike on first frame
  const dt = Math.min((ts - lastTime) / 1000, 0.05); // cap at 50ms
  lastTime = ts;
  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

function startGame() {
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('death-screen').style.display = 'none';
  document.getElementById('level-up').style.display = 'none';
  paused = false;
  game = initGame();
  const nameEl = document.getElementById('name-input');
  if (nameEl && nameEl.value.trim()) game.playerName = nameEl.value.trim();
  startMusic();
  track({ type: 'game_start' });
  if (!gameStarted) {
    gameStarted = true;
    lastTime = 0; // reset so first frame gets zero dt
    requestAnimationFrame(gameLoop);
  }
}

// keyboard weapon select + start/retry
document.addEventListener('keydown', e => {
  const startScreen = document.getElementById('start-screen');
  const deathScreen = document.getElementById('death-screen');
  const startVisible = startScreen.style.display !== 'none' && startScreen.offsetParent !== null;
  const deathVisible = deathScreen.style.display === 'flex';
  if (startVisible) {
    if (e.key === '1') selectWeapon('spit');
    else if (e.key === '2') selectWeapon('breath');
    else if (e.key === '3') selectWeapon('charge');
    else if (e.key === 'Enter' || e.key === ' ') { startGame(); e.preventDefault(); }
  }
  if (deathVisible) {
    if (e.key === 'Enter' || e.key === ' ') { startGame(); e.preventDefault(); }
  }
});

// --- dev hook for stress testing (localhost only) ---
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window._dev = {
    spawnEnemies: (n) => { if (game) for (let i = 0; i < n; i++) spawnEnemy(game); },
    spawnParticles: (x, y, n) => spawnParticles(x, y, '#ff0', n),
    getStats: () => game ? { enemies: game.enemies.length, projectiles: game.projectiles.length, particles: game.particles.length, gems: game.gems.length } : null,
    getGame: () => game,
  };
}

// Expose handlers used by inline HTML onclick attributes.
window.startGame = startGame;
window.selectWeapon = selectWeapon;
