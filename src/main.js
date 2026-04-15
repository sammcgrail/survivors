// ============================================================
// SURVIVORS v1a — single-player client entry point
// Bundled by scripts/build.cjs → bundle.js (loaded by v1a.html)
// ============================================================

import { WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP, XP_MAGNET_RANGE, XP_MAGNET_SPEED } from './shared/constants.js';
import { sfx, setSfxVol as _setSfxVol, getSfxVol, getAudioCtx as getAudio } from './shared/sfx.js';
import { installKeyboardInput } from './shared/input.js';
import { makeBgmPlayer } from './shared/bgm.js';
import { WEAPON_ICONS, createWeapon } from './shared/weapons.js';
import { createRng } from './shared/sim/rng.js';
import { EVT } from './shared/sim/events.js';
import { spawnEnemy } from './shared/sim/enemies.js';
import { POWERUPS, getAvailableChoices } from './shared/sim/powerups.js';
import { tickSim } from './shared/sim/tick.js';
import { escapeHTML } from './shared/htmlEscape.js';
import { MAPS, resolveMapObstacles } from './shared/maps.js';
import { pushOutOfObstacles } from './shared/sim/collision.js';
import { buildBackgroundCanvas } from './shared/tileBackground.js';
import { loadObstacleSprites, drawObstacle, drawNeonBackground } from './shared/obstacleSprites.js';
import { UNLOCKS, calculateScales, loadPrestige, savePrestige, applyPrestigeUnlocks, toggleCosmetic } from './shared/prestige.js';
import { makeDrawSprite, drawHpBar, drawParticles, drawFloatingTexts, drawChainEffects, drawMeteorEffects, drawPlayerBody, drawFacingIndicator, drawChargeTrail, spawnFireTrail, renderWorld } from './shared/render.js';
import { synthesizeView } from './shared/view.js';
import { applySimEvent } from './shared/simEventHandler.js';
import { markSeen, getBestiaryEntries } from './shared/bestiary.js';

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

const drawSprite = makeDrawSprite(ctx, spriteSheet, () => spritesReady);

// --- sound effects (Web Audio API) ---
// sfx() + audio context + master gain live in shared/sfx.js so MP
// gets the same switch (was missing several cases). getAudio is
// imported under that name so the existing BGM call sites don't
// have to change.

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

// --- music system (menu + battle, map-aware + mute toggle) ---
const MAP_TRACKS = {
  arena: 'arena_theme.ogg',
  neon: 'neon_grid.ogg',
  forest: 'forest_theme.ogg',
  graveyard: 'graveyard_theme.ogg',
  ruins: 'ruins_theme.ogg',
  // Procedural maps reuse their thematic parent's track — wilderness is
  // a forest variant, catacombs a ruins variant.
  wilderness: 'forest_theme.ogg',
  catacombs: 'ruins_theme.ogg',
};
const MENU_TRACK = 'menu_theme.ogg';
const DEFAULT_TRACK_OGG = 'survivors_battle.ogg';
// BGM volume — persisted per-slider in localStorage. SFX volume
// lives in shared/sfx.js (since the gain node is created there).
let bgmVol = 0.45;
try { const v = localStorage.getItem('survivors_bgm_vol'); if (v !== null) bgmVol = +v; } catch (_) {}
const MENU_VOL_RATIO = 0.67; // menu music plays at 67% of bgm slider

let menuMusicStarted = false;
let musicMuted = false;
try { musicMuted = localStorage.getItem('survivors_mute') === '1'; } catch (_) {}
function updateMuteBtn() {
  const b = document.getElementById('mute-btn');
  if (b) b.textContent = musicMuted ? '🔇' : '🔊';
}
function initVolSliders() {
  const bs = document.getElementById('vol-bgm');
  const ss = document.getElementById('vol-sfx');
  if (bs) bs.value = Math.round(bgmVol * 100);
  if (ss) ss.value = Math.round(getSfxVol() * 100);
}
updateMuteBtn();
initVolSliders();

function setBgmVol(v) {
  bgmVol = Math.max(0, Math.min(1, v / 100));
  try { localStorage.setItem('survivors_bgm_vol', bgmVol.toFixed(2)); } catch (_) {}
  if (!musicMuted) {
    battlePlayer.setVol(bgmVol);
    menuPlayer.setVol(bgmVol * MENU_VOL_RATIO);
  }
}
function setSfxVol(v) {
  // Slider is 0..100; shared module owns persistence + gain wiring.
  _setSfxVol(Math.max(0, Math.min(1, v / 100)));
}
function toggleVolPanel() {
  const p = document.getElementById('vol-panel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

// Menu music — plays on the start/death screen. Fades out when game
// starts, fades back in on return. Barn's E dorian 78 BPM ambient.
// fadeIn keeps the audio element loaded so the track resumes from
// where it was paused instead of restarting from 0:00.
const battlePlayer = makeBgmPlayer();
const menuPlayer = makeBgmPlayer();

function startMenuMusic() {
  if (menuMusicStarted) return;
  menuPlayer.play(MENU_TRACK, musicMuted ? 0 : bgmVol * MENU_VOL_RATIO);
  menuMusicStarted = true;
}
function fadeOutMenuMusic() { menuPlayer.fadeOut(); }
function fadeInMenuMusic() {
  menuPlayer.play(MENU_TRACK, musicMuted ? 0 : bgmVol * MENU_VOL_RATIO);
}

function startMusic() {
  const mapId = (game && game.mapId) || selectedMapId || 'arena';
  const src = MAP_TRACKS[mapId] || DEFAULT_TRACK_OGG;
  battlePlayer.play(src, musicMuted ? 0 : bgmVol);
}
function fadeOutMusic() { battlePlayer.fadeOut(); }

function toggleMuteMusic() {
  musicMuted = !musicMuted;
  try { localStorage.setItem('survivors_mute', musicMuted ? '1' : '0'); } catch (_) {}
  updateMuteBtn();
  battlePlayer.setVol(musicMuted ? 0 : bgmVol, 0.3);
  menuPlayer.setVol(musicMuted ? 0 : bgmVol * MENU_VOL_RATIO, 0.3);
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
let selectedMapId = 'neon';    // default map (code-rendered abstract grid)

function selectWeapon(type) {
  selectedWeapon = type;
  startMenuMusic(); // first interaction triggers audio context
  document.querySelectorAll('.weapon-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.weapon === type);
  });
}
// Map dropdown handler. Persists choice across reloads via localStorage
// so users don't have to re-pick every time. Bundle loads at end of
// body, so the DOM lookup below is safe to run synchronously.
function selectMap(id) {
  if (!MAPS[id]) return;
  selectedMapId = id;
  try { localStorage.setItem('survivors_map', id); } catch (e) {}
}
try {
  const saved = localStorage.getItem('survivors_map');
  if (saved && MAPS[saved]) {
    selectedMapId = saved;
    const el = document.getElementById('map-select');
    if (el) el.value = saved;
  }
} catch (e) {}
let gameStarted = false;

// --- init game ---
function initGame() {
  const map = MAPS[selectedMapId] || MAPS.arena;
  // rng hoisted out of the game literal so procedural obstacles can
  // share the same seed — deterministic layouts + deterministic spawns
  // off one roll.
  const rng = createRng(Date.now() & 0x7fffffff);
  const obstacles = resolveMapObstacles(map, rng);
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
    projectileBonus: 0,
    sizeMulti: 1,
    armor: 0,
    xp: 0,
    xpToLevel: 45,
    level: 1,
    weapons: [createWeapon(selectedWeapon)], // start with chosen weapon
    alive: true,
    iframes: 0, // invincibility frames after hit
    facing: { x: 1, y: 0 },
    id: 0, kills: 0, score: 0, // shared shape with MP — sim attributes kills via id
    // Per-player powerup stack counts. Starting weapon = stack 1 so its
    // upgrade powerups (e.g. spit_up) unlock immediately.
    powerupStacks: { ['weapon_' + selectedWeapon]: 1 },
  };

  applyPrestigeUnlocks(p);

  // Headstart prestige bumps level before the game starts. Scale xp
  // thresholds to match and queue a level-up choice for the bonus level.
  const prestigeLevels = p.level - 1;
  if (prestigeLevels > 0) {
    for (let i = 0; i < prestigeLevels; i++) p.xpToLevel = Math.floor(p.xpToLevel * 1.30);
  }

  return {
    player: p,
    players: [p], // sim modules iterate g.players; SP is just a 1-elem list
    enemies: [],
    projectiles: [],
    gems: [],
    heartDrops: [],
    consumables: [],
    enemyProjectiles: [],
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
    rng,
    // Visual effect arrays — chain bolts and meteor warn/explode rings.
    // Eager-init here so sim modules don't need defensive `|| []` checks.
    chainEffects: [],
    meteorEffects: [],
    chargeTrails: [],
    // Map state — `arena` overrides the global WORLD dims; `obstacles`
    // is consumed by sim/collision.js and rendered by the canvas pass.
    arena: { w: map.width, h: map.height },
    obstacles,
    mapId: selectedMapId,
    // Active cosmetics from prestige (read once at game start)
    _activeSkin: loadPrestige().activeSkin,
    _activeTrail: loadPrestige().activeTrail,
    _trailState: new Map(),
  };
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
  const slow = p._terrainSlow || 1;
  p.x += dx * p.speed * slow * dt;
  p.y += dy * p.speed * slow * dt;
  p.x = Math.max(p.radius, Math.min(g.arena.w - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(g.arena.h - p.radius, p.y));
  if (g.obstacles.length > 0) pushOutOfObstacles(p, g.obstacles);

  // hp regen
  if (p.hpRegen > 0) {
    p.hp = Math.min(p.maxHp, p.hp + p.hpRegen * dt);
  }

  // iframes countdown
  if (p.iframes > 0) p.iframes -= dt;

  // --- authoritative sim tick (waves → weapons → projectiles → auras
  //     → enemies → gems → chain/meteor effect lifetimes). Order is
  //     load-bearing; see src/shared/sim/tick.js for rationale.
  tickSim(g, dt);

  if (p.alive && g._activeTrail === 'trail_fire') {
    spawnFireTrail(p, dt, g.particles, g._trailState);
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
    for (const evt of g.events) applySimEvent(evt, spEventClient);
    g.events.length = 0;
  }
}

// SP event-client shim — drains g.events via the shared
// applySimEvent. DOM-flip callbacks wire through to the local
// level-up menu + death screen.
const spEventClient = {
  get particles()     { return game?.particles; },
  get floatingTexts() { return game?.floatingTexts; },
  sfx,
  shake(v) { if (game) game.screenShake = Math.max(game.screenShake, v); },
  flash(v) { if (game) game.levelFlash  = Math.max(game.levelFlash || 0, v); },
  onLevelUp()     { if (game) showLevelUp(game); },
  onPlayerDeath(evt) {
    if (!game) return;
    game.deathFeed.push({ text: `${game.playerName} killed by ${evt.by}`, time: game.time });
    showDeathScreen(game);
  },
  onWaveSurvived(evt) {
    if (!game) return;
    game.deathFeed.push({ text: `${game.playerName} survived wave ${evt.wave}`, time: evt.time });
  },
};

// --- level up UI ---
// Returns the `stats` string from the catalog entry, or '' if absent.
function formatUpgradeStat(choice) {
  return choice.stats || '';
}

function showLevelUp(g) {
  sfx('levelup');
  paused = true;
  const stacks = g.player.powerupStacks;
  // pick 3 random valid options — Fisher-Yates shuffle (the
  // sort(() => Math.random()-0.5) one-liner is biased, doesn't even
  // produce a uniform distribution). Matches server.mjs:175.
  const available = getAvailableChoices(stacks);
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  const choices = available.slice(0, 3);

  const container = document.getElementById('level-choices');
  container.innerHTML = '';
  document.getElementById('level-up').style.display = 'flex';

  // store choices globally for keyboard selection
  window._levelChoices = [];
  for (let ci = 0; ci < choices.length; ci++) {
    const choice = choices[ci];
    const isEvo = !!choice.requiresEvo;
    const div = document.createElement('div');
    div.className = 'choice' + (isEvo ? ' choice--evo' : '');
    div.innerHTML = `
      <div class="name"><span style="color:#555;font-size:0.6rem">[${ci+1}]</span> ${choice.icon} ${choice.name}</div>
      <div class="desc">${choice.desc}</div>
    `;
    if (isEvo) {
      const badge = document.createElement('div');
      badge.className = 'choice-evo-badge';
      badge.textContent = '✦ EVOLUTION';
      div.prepend(badge);
    }
    const statText = formatUpgradeStat(choice);
    if (statText) {
      const statsEl = document.createElement('div');
      statsEl.className = 'choice-stats';
      statsEl.textContent = statText;
      div.appendChild(statsEl);
    }
    const pick = () => {
      stacks[choice.id] = (stacks[choice.id] || 0) + 1;
      choice.apply(g, g.player);
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
  fadeInMenuMusic();
  track({ type: 'death', wave: g.wave, kills: g.kills, weapons: g.player.weapons.map(w => w.type) });
  const mins = Math.floor(g.time / 60);
  const secs = Math.floor(g.time % 60);
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
  const weaponList = g.player.weapons.map(w => WEAPON_ICONS[w.type] || '?').join(' ');
  const stacks = g.player.powerupStacks;
  const powerupList = POWERUPS
    .filter(p => (stacks[p.id] || 0) > 0 && !p.id.startsWith('weapon_'))
    .map(p => `${p.icon}×${stacks[p.id]}`).join(' ');

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
  const owned = POWERUPS.filter(p => (stacks[p.id] || 0) > 0);
  if (owned.length > 0) {
    loadoutEl.innerHTML = owned.map(p => {
      const n = stacks[p.id];
      const stackStr = n > 1 ? ` ×${n}` : '';
      return `<div class="loadout-item"><span class="li-icon">${p.icon}</span>${p.name}${stackStr}</div>`;
    }).join('');
  } else {
    loadoutEl.innerHTML = '<div class="loadout-item" style="color:#555">no powerups</div>';
  }
  // submit to leaderboard + fetch top 10
  const lbEl = document.getElementById('death-leaderboard');
  const lbPlaceEl = document.getElementById('death-lb-placement');
  lbEl.innerHTML = '<div class="lb-title">leaderboard</div><div style="color:#555;font-size:0.7rem;text-align:center">loading...</div>';
  lbPlaceEl.innerHTML = '';

  const playerName = g.playerName || 'anon';
  const weaponTypes = g.player.weapons.map(w => w.type);

  // submit score
  fetch(`${ANALYTICS_URL}/leaderboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: playerName, wave: g.wave, kills: g.kills, time: g.time, weapons: weaponTypes }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.rank) {
        lbPlaceEl.innerHTML = `<div class="lb-placement">#${res.rank} of ${res.total}</div>`;
      }
    })
    .catch(() => {});

  // fetch top 10
  fetch(`${ANALYTICS_URL}/leaderboard?limit=10`)
    .then(r => r.json())
    .then(entries => {
      if (!entries || entries.length === 0) {
        lbEl.innerHTML = '<div class="lb-title">leaderboard</div><div style="color:#555;font-size:0.7rem;text-align:center">no runs yet</div>';
        return;
      }
      const header = `<div class="lb-title">leaderboard</div>
        <div class="lb-row" style="color:#444;font-size:0.6rem;border-bottom:1px solid #333">
          <span class="lb-rank">#</span><span class="lb-name">name</span>
          <span class="lb-wave">wave</span><span class="lb-kills">kills</span><span class="lb-time">time</span>
        </div>`;
      // Names come from arbitrary players via the leaderboard backend —
      // escape before innerHTML or `<img onerror=alert(1)>` would XSS.
      const rows = entries.map((e, i) => {
        const m = Math.floor(e.time / 60);
        const s = Math.floor(e.time % 60);
        const isYou = e.name === playerName && e.wave === g.wave && e.kills === g.kills;
        return `<div class="lb-row${isYou ? ' lb-you' : ''}">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${escapeHTML(e.name)}</span>
          <span class="lb-wave">W${e.wave | 0}</span>
          <span class="lb-kills">${e.kills | 0}k</span>
          <span class="lb-time">${m | 0}:${(s | 0).toString().padStart(2, '0')}</span>
        </div>`;
      }).join('');
      lbEl.innerHTML = header + rows;
    })
    .catch(() => {
      lbEl.innerHTML = '<div class="lb-title">leaderboard</div><div style="color:#555;font-size:0.7rem;text-align:center">offline</div>';
    });

  // --- dragon scales prestige ---
  const scalesRun = {
    wave: g.wave,
    kills: g.kills,
    powerupStacks: g.player.powerupStacks,
  };
  const earned = calculateScales(scalesRun);
  const prestige = loadPrestige();
  prestige.scales += earned;
  prestige.totalEarned += earned;
  savePrestige(prestige);

  // breakdown
  const waveScales = Math.floor(g.wave / 2);
  const killScales = Math.floor(g.kills / 50);
  let evoScales = 0;
  for (const k in g.player.powerupStacks) {
    if (k.startsWith('evo_') && g.player.powerupStacks[k] > 0) evoScales += g.player.powerupStacks[k];
  }
  const scalesEl = document.getElementById('death-scales');
  scalesEl.innerHTML = `
    <div class="scales-earned">+${earned} DRAGON SCALES</div>
    <div class="scales-breakdown">wave: ${waveScales} | kills: ${killScales} | evolutions: ${evoScales}</div>
    <div class="scales-total">Total: ${prestige.scales} scales</div>
  `;

  document.getElementById('death-screen').style.display = 'flex';
}

// --- render ---
function render() {
  const W = canvas.width;
  const H = canvas.height;
  const g = game;
  if (!g) return;
  if (PERF_ON) _phaseT = performance.now();

  ctx.save();
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  // camera transform — floor (not round) to integer pixels. Math.round
  // causes diagonal jitter because x and y independently flip between
  // rounding up/down on different frames. Floor is monotonic.
  let cx = g.camera.x - W / 2;
  let cy = g.camera.y - H / 2;

  // screen shake
  if (g.screenShake > 0) {
    cx += (Math.random() - 0.5) * 8;
    cy += (Math.random() - 0.5) * 8;
  }

  cx = Math.floor(cx);
  cy = Math.floor(cy);

  ctx.translate(-cx, -cy);

  // --- background: pre-baked Wang-sampled tileset (when loaded), neon
  //     abstract render for code-only maps, or fallback dark grid. The
  //     bg canvas is at native tile resolution; nearest-neighbor scale
  //     keeps the pixel art crisp. ---
  if (g.bgCanvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(g.bgCanvas, 0, 0, g.bgCanvas.width, g.bgCanvas.height,
                  0, 0, g.arena.w, g.arena.h);
    ctx.imageSmoothingEnabled = true;
  } else if (MAPS[g.mapId]?.abstractRender === 'neon') {
    drawNeonBackground(ctx, cx, cy, W, H, g.arena);
  } else {
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
  }

  // --- world border ---
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, g.arena.w, g.arena.h);

  // --- map obstacles ---
  for (const obs of g.obstacles) {
    if (obs.x + obs.w < cx || obs.x > cx + W || obs.y + obs.h < cy || obs.y > cy + H) continue;
    drawObstacle(ctx, obs);
  }
  _phase('bg');

  const p = g.player;
  renderWorld(ctx, synthesizeView(g), drawSprite, g.particles,
              { cx, cy, W, H },
              { onSeen: (name) => markSeen(name, g.wave), onPhase: PERF_ON ? _phase : null });
  drawChargeTrail(ctx, g.players);
  drawChainEffects(ctx, g.chainEffects);
  drawMeteorEffects(ctx, g.meteorEffects);
  _phase('worldfx');

  // --- player ---
  if (p.alive) {
    const skin = g._activeSkin;
    const glowColor = skin === 'skin_gold' ? '#f39c12'
                    : skin === 'skin_shadow' ? '#9b59b6'
                    : '#3498db';
    const fallbackFill = skin === 'skin_gold' ? '#f1c40f'
                       : skin === 'skin_shadow' ? '#6c3483'
                       : '#eee';

    drawPlayerBody(ctx, p, drawSprite, g.time, {
      skin, radius: p.radius, glowColor, fallbackFill,
    });
    drawFacingIndicator(ctx, p, glowColor, p.radius);

    // name tag above player
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.8;
    ctx.fillText(g.playerName, p.x, p.y - p.radius - 16);
    ctx.globalAlpha = 1;

    drawHpBar(ctx, p.x, p.y - p.radius - 10, 30, p.hp / p.maxHp);
  }
  _phase('player');

  drawParticles(ctx, g.particles);
  _phase('particles');

  drawFloatingTexts(ctx, g.floatingTexts);
  _phase('floats');

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
  _phase('hud');

}

// --- input ---
// Keyboard handlers + KEY_MAP live in shared/input.js. Level-up
// callback gates on `paused` (SP's pause flag = level-up overlay
// is open). `onClear` resets analog joystick state too — the
// joystick itself stays inline below since SP needs analog
// magnitude that MP doesn't (MP only sends boolean keys to server).
installKeyboardInput(keys, {
  onLevelUpKey(idx) {
    if (!paused || !window._levelChoices) return false;
    const pick = window._levelChoices[idx];
    if (!pick) return false;
    pick();
    return true;
  },
  onClear() { analogMove.x = 0; analogMove.y = 0; },
});

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

// Lightweight perf-profile harness — opt-in via ?perf=1. Samples
// update() vs render() vs each render phase (background, world,
// players, hud) into rolling buckets and logs avg/p95/max every
// 120 frames. Off by default so production has zero overhead
// beyond a single boolean check per gameLoop call.
const PERF_ON = typeof location !== 'undefined' && /[?&]perf=1\b/.test(location.search);
const _perfBuckets = PERF_ON ? Object.create(null) : null;
let _perfFrames = 0;
let _phaseT = 0; // last phase boundary timestamp, reset at render start

function _perfMark(label, ms) {
  let b = _perfBuckets[label];
  if (!b) { b = _perfBuckets[label] = []; }
  b.push(ms);
  if (b.length > 600) b.shift(); // keep last ~10s at 60fps
}

// Call between render phases to close out the previous bucket. No-op
// unless PERF_ON. Keeps the call-site ergonomic: `_phase('world')`.
function _phase(label) {
  if (!PERF_ON) return;
  const n = performance.now();
  _perfMark('r.' + label, n - _phaseT);
  _phaseT = n;
}

function _perfReport() {
  const out = ['[perf]'];
  for (const label of Object.keys(_perfBuckets)) {
    const b = _perfBuckets[label];
    if (b.length === 0) continue;
    const sorted = [...b].sort((a, b) => a - b);
    const avg = b.reduce((s, x) => s + x, 0) / b.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const max = sorted[sorted.length - 1];
    out.push(`${label}: avg=${avg.toFixed(2)} p95=${p95.toFixed(2)} max=${max.toFixed(2)}`);
  }
  console.log(out.join('  '));
}

function gameLoop(ts) {
  if (lastTime === 0) lastTime = ts; // prevent huge dt spike on first frame
  const dt = Math.min((ts - lastTime) / 1000, 0.05); // cap at 50ms
  lastTime = ts;
  if (PERF_ON) {
    const t0 = performance.now();
    update(dt);
    const t1 = performance.now();
    render();
    const t2 = performance.now();
    _perfMark('update', t1 - t0);
    _perfMark('render', t2 - t1);
    _perfMark('frame',  t2 - t0);
    if (++_perfFrames % 120 === 0) _perfReport();
  } else {
    update(dt);
    render();
  }
  requestAnimationFrame(gameLoop);
}

// Expose a quick console hook for ad-hoc profiling: window._perf.report()
if (PERF_ON && typeof window !== 'undefined') {
  window._perf = { mark: _perfMark, report: _perfReport, buckets: _perfBuckets };
}

// --- prestige shop ---
function showPrestigeShop() {
  const prestige = loadPrestige();
  document.getElementById('scale-count').textContent = prestige.scales;
  const grid = document.getElementById('unlock-grid');
  grid.innerHTML = UNLOCKS.map(u => {
    const owned = prestige.unlocks[u.id] || 0;
    const maxed = owned >= u.max;
    const canBuy = !maxed && prestige.scales >= u.cost;
    const stackStr = u.max > 1 ? ` (${owned}/${u.max})` : (maxed ? '' : '');
    // Cosmetic equip state
    const isEquipped = (u.id === prestige.activeSkin || u.id === prestige.activeTrail);
    const equipLabel = isEquipped ? 'EQUIPPED' : (maxed && u.cosmetic ? 'EQUIP' : '');
    const equipClass = isEquipped ? ' unlock-equipped' : '';
    const clickAction = canBuy ? `purchaseUnlock('${u.id}')`
                      : (maxed && u.cosmetic) ? `toggleCosmeticEquip('${u.id}')`
                      : '';
    return `<div class="unlock-card${maxed ? ' unlock-maxed' : ''}${canBuy ? ' unlock-available' : ''}${equipClass}" onclick="${clickAction}">
      <div class="unlock-icon">${u.icon}</div>
      <div class="unlock-name">${u.name}${stackStr}</div>
      <div class="unlock-desc">${u.desc}</div>
      <div class="unlock-cost">${equipLabel ? `<span class="equip-tag${isEquipped ? ' equipped' : ''}">${equipLabel}</span>` : (maxed ? 'MAXED' : u.cost + ' scales')}</div>
    </div>`;
  }).join('');
  document.getElementById('prestige-shop').style.display = 'flex';
}

function toggleCosmeticEquip(id) {
  toggleCosmetic(id);
  showPrestigeShop(); // refresh
}

function hidePrestigeShop() {
  document.getElementById('prestige-shop').style.display = 'none';
}

function purchaseUnlock(id) {
  const u = UNLOCKS.find(x => x.id === id);
  if (!u) return;
  const prestige = loadPrestige();
  const owned = prestige.unlocks[u.id] || 0;
  if (owned >= u.max || prestige.scales < u.cost) return;
  prestige.scales -= u.cost;
  prestige.unlocks[u.id] = owned + 1;
  savePrestige(prestige);
  showPrestigeShop(); // refresh display
}

function startGame() {
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('death-screen').style.display = 'none';
  hidePrestigeShop();
  document.getElementById('level-up').style.display = 'none';
  paused = false;
  game = initGame();
  // Headstart prestige: queue level-up choices for bonus levels so the
  // player picks a perk immediately on game start.
  for (let i = 1; i < game.player.level; i++) {
    game.events.push({ type: EVT.LEVEL_UP, level: i + 1, pid: game.player.id });
  }
  const nameEl = document.getElementById('name-input');
  if (nameEl && nameEl.value.trim()) game.playerName = nameEl.value.trim();
  fadeOutMenuMusic();
  startMusic();
  track({ type: 'game_start' });
  // Load this map's ground tileset (async — render falls back to grid
  // until it resolves).
  buildBackgroundCanvas(game.mapId).then(c => { if (game) game.bgCanvas = c; }).catch(() => {});
  loadObstacleSprites();
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
    startMenuMusic(); // any key on start screen triggers audio
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
window.selectMap = selectMap;
window.showPrestigeShop = showPrestigeShop;
window.hidePrestigeShop = hidePrestigeShop;
window.purchaseUnlock = purchaseUnlock;
window.toggleCosmeticEquip = toggleCosmeticEquip;
window.toggleMute = toggleMuteMusic;
window.setBgmVol = setBgmVol;
window.setSfxVol = setSfxVol;
window.toggleVolPanel = toggleVolPanel;
window.showBestiary = showBestiary;
window.hideBestiary = hideBestiary;

// --- bestiary UI ---
function showBestiary() {
  const overlay = document.getElementById('bestiary');
  const grid = document.getElementById('bestiary-grid');
  const progress = document.getElementById('bestiary-progress');
  const entries = getBestiaryEntries();
  const seen = entries.filter(e => e.firstWave !== null).length;
  if (progress) progress.textContent = `${seen} / ${entries.length} discovered`;
  grid.innerHTML = entries.map(e => {
    if (e.firstWave === null) {
      return `<div class="beast-card unseen">
        <div class="beast-swatch unseen"></div>
        <div class="beast-name">???</div>
        <div class="beast-wave">undiscovered</div>
        <div class="beast-stats">hp - · spd - · dmg -</div>
        <div class="beast-desc">Keep playing to unlock.</div>
      </div>`;
    }
    return `<div class="beast-card">
      <div class="beast-swatch" style="background:${e.color}; color:${e.color};"></div>
      <div class="beast-name">${escapeHTML(e.info.display)}</div>
      <div class="beast-wave">first seen: wave ${e.firstWave}</div>
      <div class="beast-stats">hp ${e.baseStats.hp} · spd ${e.baseStats.speed} · dmg ${e.baseStats.damage}</div>
      <div class="beast-desc">${escapeHTML(e.info.desc)}</div>
    </div>`;
  }).join('');
  overlay.style.display = 'flex';
}
function hideBestiary() {
  document.getElementById('bestiary').style.display = 'none';
}
