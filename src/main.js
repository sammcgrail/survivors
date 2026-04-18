// ============================================================
// SURVIVORS v1a — single-player client entry point
// Bundled by scripts/build.cjs → bundle.js (loaded by v1a.html)
// ============================================================

import { WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP, XP_MAGNET_RANGE, XP_MAGNET_SPEED } from './shared/constants.js';
import { sfx, getSfxVol, getAudioCtx as getAudio } from './shared/sfx.js';
import { installKeyboardInput } from './shared/input.js';
import { initMusic } from './shared/musicDirector.js';
import { bootSharedServices } from './shared/boot.js';
import { WEAPON_ICONS, createWeapon } from './shared/weapons.js';
import { decorateWeaponCard } from './shared/levelUpCard.js';
import { renderDeathHighlights } from './shared/deathHighlights.js';
import { renderWeaponHistogram } from './shared/weaponPickHistogram.js';
import { powerupIconHTML, relicIconHTML } from './shared/sprites.js';
import { bindResize } from './shared/viewport.js';
import { bindTouchJoystick } from './shared/joystick.js';
// clampSliderVol import removed — setSfxVol now lives in boot.js (step 3b)
import { createRng } from './shared/sim/rng.js';
import { EVT } from './shared/sim/events.js';
import { spawnEnemy } from './shared/sim/enemies.js';
import { POWERUPS } from './shared/sim/powerups.js';
import { RELICS } from './shared/relics.js';
import { buildLevelUpChoices } from './shared/levelUp.js';
import { tickSim } from './shared/sim/tick.js';
import { escapeHTML } from './shared/htmlEscape.js';
import { MAPS, resolveMapObstacles } from './shared/maps.js';
import { pushOutOfObstacles } from './shared/sim/collision.js';
import { buildBackgroundCanvas } from './shared/tileBackground.js';
import { loadObstacleSprites, drawObstacle } from './shared/obstacleSprites.js';
import { drawBackground } from './shared/backgroundRenderer.js';
import { UNLOCKS, calculateScales, loadPrestige, savePrestige, applyPrestigeUnlocks, toggleCosmetic } from './shared/prestige.js';
import { makeDrawSprite, drawHpBar, drawParticles, drawFloatingTexts, drawChainEffects, drawMeteorEffects, drawPendingPulls, drawPlayerBody, drawFacingIndicator, drawChargeTrail, spawnFireTrail, renderWorld } from './shared/render.js';
import { getAmbient } from './shared/mapAmbient.js';
import { synthesizeView } from './shared/view.js';
import { applySimEvent, resetParticleOverflow, safeParticlePush } from './shared/simEventHandler.js';
import { markSeen } from './shared/bestiary.js';
// showBestiary + hideBestiary moved to shared/boot.js
import { ACHIEVEMENTS, loadAchievements, grantAchievement } from './shared/achievements.js';
import { saveRunEntry } from './shared/runHistory.js';
import { createBaseGameState } from './shared/gameState.js';
import { renderDeathFeed } from './shared/deathFeed.js';

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

// --- shared bootstrap (wires toggleVolPanel, bestiary, mute, bgm, sfx) ---
bootSharedServices({ isMP: false });

// --- music system (singleton — created by bootSharedServices, retrieved here) ---
const music = initMusic({ hasMenu: true });
const { startMenuMusic, fadeOutMenuMusic, fadeInMenuMusic } = music;
function startMusic() {
  const mapId = (game && game.mapId) || selectedMapId || 'arena';
  music.startBattleMusic(mapId);
}
function fadeOutMusic() { music.fadeOutBattleMusic(); }
bindResize(canvas);

// --- constants ---
// --- game state ---
let game = null;
let keys = { up: false, down: false, left: false, right: false };
let analogMove = { x: 0, y: 0 }; // smooth analog input from touch
let paused = false;
let pendingLevelUps = 0;
let selectedWeapon = 'spit'; // default starting weapon
let selectedMapId = 'random';  // default: random pick each game

const MAP_LABELS = {
  random:     { label: 'Random',  icon: '🎲' },
  arena:      { label: 'Arena',   icon: '⚔️' },
  forest:     { label: 'Forest',  icon: '🌲' },
  ruins:      { label: 'Ruins',   icon: '🏛️' },
  neon:       { label: 'Neon',    icon: '⚡' },
  wilderness: { label: 'Wild',    icon: '🌿' },
  catacombs:  { label: 'Tombs',   icon: '💀' },
  graveyard:  { label: 'Graves',  icon: '⚰️' },
};

function renderMapPicker() {
  const container = document.getElementById('map-picker-cards');
  if (!container) return;
  container.innerHTML = '';
  const options = ['random', ...Object.keys(MAPS)];
  for (const id of options) {
    const meta = MAP_LABELS[id] || { label: id, icon: '🗺️' };
    const card = document.createElement('div');
    card.className = `map-card${selectedMapId === id ? ' map-card--selected' : ''}`;
    card.innerHTML = `<span style="font-size:18px">${meta.icon}</span><span style="font-size:11px">${meta.label}</span>`;
    card.addEventListener('click', () => selectMap(id));
    container.appendChild(card);
  }
}

function selectWeapon(type) {
  selectedWeapon = type;
  startMenuMusic(); // first interaction triggers audio context
  document.querySelectorAll('.weapon-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.weapon === type);
  });
}
// Map picker handler. Accepts 'random' or any MAPS key. Persists
// choice in localStorage; bundle loads at end of body so DOM is ready.
function selectMap(id) {
  if (id !== 'random' && !MAPS[id]) return;
  selectedMapId = id;
  try { localStorage.setItem('survivors_map', id); } catch (e) {}
  renderMapPicker();
}
try {
  const saved = localStorage.getItem('survivors_map');
  if (saved && (saved === 'random' || MAPS[saved])) selectedMapId = saved;
} catch (e) {}
renderMapPicker();
let gameStarted = false;

// --- achievements ---
let achievements = loadAchievements(); // persists across sessions in localStorage
let sessionNewUnlocks = [];            // ids unlocked this run (drives toast queue)

// --- init game ---
function initGame() {
  const mapKeys = Object.keys(MAPS);
  const resolvedMapId = (selectedMapId === 'random' || !MAPS[selectedMapId])
    ? mapKeys[Math.floor(Math.random() * mapKeys.length)]
    : selectedMapId;
  const map = MAPS[resolvedMapId];
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
    magnetBoost: 0,  // consumable magnet pulse timer (sec); >0 → infinite pickup range + 4x pull speed
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
    // Death-screen highlight tracking — written by damageEnemy, read
    // by showDeathScreen. Must init to zero/empty so MVP/overkill/
    // max-hit reads stay safe for untouched runs.
    dmgByWeapon: {}, overkills: 0, maxHit: 0, maxHitEnemy: null,
    // Per-player powerup stack counts. Starting weapon = stack 1 so its
    // upgrade powerups (e.g. spit_up) unlock immediately.
    powerupStacks: { ['weapon_' + selectedWeapon]: 1 },
    // Relic stack counts — keyed by relic id, value = stack count.
    relics: {},
  };

  applyPrestigeUnlocks(p);

  // Headstart prestige bumps level before the game starts. Scale xp
  // thresholds to match and queue a level-up choice for the bonus level.
  const prestigeLevels = p.level - 1;
  if (prestigeLevels > 0) {
    for (let i = 0; i < prestigeLevels; i++) p.xpToLevel = Math.floor(p.xpToLevel * 1.22);
  }

  return {
    player: p,
    players: [p], // sim modules iterate g.players; SP is just a 1-elem list
    enemies: [],
    projectiles: [],
    gems: [],
    heartDrops: [],
    consumables: [],
    chests: [],
    enemyProjectiles: [],
    ...createBaseGameState(),
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
    mapId: resolvedMapId,
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
    safeParticlePush(game.particles, {
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
  // Swap-delete: replace dead particle with the last array element then
  // pop — O(1) removal vs O(n) splice. Safe in a reverse loop because the
  // swapped-in element (formerly at [length-1]) was already visited.
  for (let i = g.particles.length - 1; i >= 0; i--) {
    const pt = g.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) {
      g.particles[i] = g.particles[g.particles.length - 1];
      g.particles.pop();
    }
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
    resetParticleOverflow(); // one overflow log per drain, not per event
    for (const evt of g.events) {
      applySimEvent(evt, spEventClient);
      // Achievement checks on per-event triggers.
      if (evt.type === 'enemyKilled') {
        unlockAchievement('first_blood');
        if (evt.name === 'boss') unlockAchievement('boss_slayer');
      } else if (evt.type === 'levelUp' && evt.level >= 10) {
        unlockAchievement('level_10');
      } else if (evt.type === 'evolution') {
        unlockAchievement('evolved');
      }
    }
    g.events.length = 0;
  }

  // State-based milestone checks (run every frame, idempotent via grantAchievement).
  if (g.wave >= 10)  unlockAchievement('wave_10');
  if (g.wave >= 20)  unlockAchievement('wave_20');
  if (g.kills >= 100)  unlockAchievement('kills_100');
  if (g.kills >= 1000) unlockAchievement('kills_1000');
  if (p.weapons.length >= 4) unlockAchievement('full_loadout');
  if (g.time >= 300) unlockAchievement('survivor_5min');
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
    // VFX pass 3 item 1 — 2s death transition before the DOM flip.
    // render() picks up g.deathTransition and desaturates + slow-zooms
    // the camera toward the corpse. gameLoop calls showDeathScreen when
    // the timer completes. Guard against double-fire races.
    if (!game.deathTransition) {
      game.deathTransition = {
        t: 0, duration: 2.0,
        deathX: evt.x ?? game.player.x,
        deathY: evt.y ?? game.player.y,
        by: evt.by,
      };
    }
  },
  onWaveSurvived(evt) {
    if (!game) return;
    game.deathFeed.push({ text: `${game.playerName} survived wave ${evt.wave}`, time: evt.time });
  },
};

// --- level up UI ---

function showLevelUp(g) {
  if (paused) {
    pendingLevelUps++;
    return;
  }
  sfx('levelup');
  paused = true;
  const stacks = g.player.powerupStacks;
  const choices = buildLevelUpChoices(stacks);

  const container = document.getElementById('level-choices');
  container.innerHTML = '';
  const overlay = document.getElementById('level-up');
  overlay.style.display = 'flex';
  // VFX pass 3 item 3 — replay the title anticipation animation on
  // every show. CSS animations only fire on element creation, so
  // force a reflow by toggling the animation property to re-trigger
  // the scale-in pop each level-up.
  const h2 = overlay.querySelector('h2');
  if (h2) {
    h2.style.animation = 'none';
    void h2.offsetHeight; // reflow
    h2.style.animation = '';
  }

  // store choices globally for keyboard selection
  window._levelChoices = [];
  for (let ci = 0; ci < choices.length; ci++) {
    const choice = choices[ci];
    const isEvo = !!choice.requiresEvo;
    const div = document.createElement('div');
    div.className = 'choice' + (isEvo ? ' choice--evo' : '');
    div.innerHTML = `
      <div class="name"><span style="color:#555;font-size:0.6rem">[${ci+1}]</span> ${powerupIconHTML(choice.id, choice.icon)} ${choice.name}</div>
      <div class="desc">${choice.desc}</div>
    `;
    if (isEvo) {
      const badge = document.createElement('div');
      badge.className = 'choice-evo-badge';
      badge.textContent = '✦ EVOLUTION';
      div.prepend(badge);
    }
    const preview = decorateWeaponCard(div, choice, g.player.weapons);
    const statText = (preview && preview.stats) || choice.stats || '';
    if (statText) {
      const statsEl = document.createElement('div');
      statsEl.className = 'choice-stats';
      statsEl.textContent = statText;
      div.appendChild(statsEl);
    }
    const pick = () => {
      stacks[choice.id] = (stacks[choice.id] || 0) + 1;
      if (choice.requiresEvo) unlockAchievement('evolved');
      choice.apply(g, g.player);
      document.getElementById('level-up').style.display = 'none';
      paused = false;
      window._levelChoices = [];
      if (pendingLevelUps > 0) {
        pendingLevelUps--;
        showLevelUp(g);
      }
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

// Show a brief achievement-unlock toast in the bottom-centre of the screen.
function showAchievementToast(id) {
  const def = ACHIEVEMENTS.find(a => a.id === id);
  if (!def) return;
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `<span class="ach-icon">${def.icon}</span> <span class="ach-label">Achievement: ${def.label}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('achievement-toast--visible'), 50);
  setTimeout(() => {
    toast.classList.remove('achievement-toast--visible');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// Grant an achievement and show a toast if newly unlocked.
function unlockAchievement(id) {
  if (grantAchievement(achievements, id)) {
    sessionNewUnlocks.push(id);
    showAchievementToast(id);
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
  const history = saveRunEntry(g);
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

  // Highlights — MVP weapon, biggest hit, overkill count. Rendered via
  // shared helper so MP's death screen uses identical markup.
  renderDeathHighlights(document.getElementById('death-highlights'), g.player);

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
  // Relic summary on death screen — show collected relics below loadout.
  const relics = g.player.relics || {};
  const ownedRelics = RELICS.filter(r => (relics[r.id] || 0) > 0);
  if (ownedRelics.length > 0) {
    const relicHtml = ownedRelics.map(r => {
      const n = relics[r.id];
      const stackStr = n > 1 ? ` x${n}` : '';
      return `<div class="loadout-item" style="color:#f1c40f"><span class="li-icon">${relicIconHTML(r.id, r.icon)}</span>${r.name}${stackStr}</div>`;
    }).join('');
    loadoutEl.innerHTML += `<div style="margin-top:6px;font-size:0.6rem;color:#b8860b;text-align:center;">Relics</div>${relicHtml}`;
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

  // Achievement badges row — persist across runs, greyed when locked.
  let achEl = document.getElementById('ds-achievements');
  if (!achEl) {
    achEl = document.createElement('div');
    achEl.id = 'ds-achievements';
    achEl.style.cssText = 'margin-top:12px;margin-bottom:4px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;';
    document.getElementById('death-scales').after(achEl);
  }
  achEl.innerHTML = '';
  const allAch = loadAchievements();
  for (const def of ACHIEVEMENTS) {
    const badge = document.createElement('span');
    badge.className = `ds-ach-badge${allAch[def.id] ? '' : ' ds-ach-badge--locked'}`;
    badge.title = `${def.label}: ${def.desc}${allAch[def.id] ? '' : ' (locked)'}`;
    badge.textContent = allAch[def.id] ? def.icon : '🔒';
    achEl.appendChild(badge);
  }

  // Run history panel — current run is index 0 (just saved by saveRunEntry above).
  let histEl = document.getElementById('ds-history');
  if (!histEl) {
    histEl = document.createElement('div');
    histEl.id = 'ds-history';
    achEl.after(histEl);
  }
  histEl.innerHTML = '<div class="ds-history-title">Recent Runs</div>';
  for (const run of history) {
    const min = Math.floor(run.time / 60);
    const sec = (run.time % 60 | 0).toString().padStart(2, '0');
    const weaponIcons = run.weapons.map(t => WEAPON_ICONS[t] ?? '⚔️').join(' ');
    const row = document.createElement('div');
    row.className = 'ds-history-row';
    row.innerHTML = `
      <span class="dhr-wave">W${run.wave}</span>
      <span class="dhr-kills">${run.kills}k</span>
      <span class="dhr-level">Lv${run.level}</span>
      <span class="dhr-time">${min}:${sec}</span>
      <span class="dhr-weapons">${weaponIcons}</span>
    `;
    histEl.appendChild(row);
  }

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
  // VFX pass 3 item 1 — death transition state. Fades saturation down
  // from 100% to 30% and zooms the camera 1.0× → 1.5× toward the
  // corpse over 2 seconds. `ctx.filter` on supported browsers handles
  // the grayscale cheaply; skipped if not supported (old browsers
  // just get the zoom without the desaturation).
  const dt = g.deathTransition;
  const deathT = dt ? Math.min(dt.t / dt.duration, 1) : 0;
  if (dt && 'filter' in ctx) {
    ctx.filter = `saturate(${100 - deathT * 70}%)`;
  }
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

  // Death transition zoom — scale the world 1.0× → 1.5× centered on
  // the corpse position. Applied before the camera translate so the
  // zoom pivots on the death point, not the screen.
  if (dt) {
    const zoom = 1 + deathT * 0.5;
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-dt.deathX, -dt.deathY);
  } else {
    ctx.translate(-cx, -cy);
  }

  // --- background: 3-tier fallback (tileset / neon / grid) ---
  drawBackground(ctx, g.bgCanvas, g.mapId, g.arena, cx, cy, W, H);

  // --- world border ---
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, g.arena.w, g.arena.h);

  // --- map obstacles ---
  for (const obs of g.obstacles) {
    if (obs.x + obs.w < cx || obs.x > cx + W || obs.y + obs.h < cy || obs.y > cy + H) continue;
    drawObstacle(ctx, obs);
  }
  // Per-map ambient VFX — fireflies, torch flicker, dust motes,
  // whatever fits the map. Runs before world render so the ambient
  // layer sits under enemies + projectiles. Null for maps without
  // a configured ambient (no-op cost).
  // Gated on !paused so the level-up menu doesn't accumulate ambient
  // particles — fixed buildup that caused a huge draw burst on menu
  // close (arena was worst; warm embers spawn at 35%/frame).
  const ambient = getAmbient(g.mapId);
  if (ambient && !paused) ambient.tick(g.particles, { cx, cy, W, H }, performance.now());
  _phase('bg');

  const p = g.player;
  renderWorld(ctx, synthesizeView(g), drawSprite, g.particles,
              { cx, cy, W, H },
              { onSeen: (name) => markSeen(name, g.wave), onPhase: PERF_ON ? _phase : null });
  drawChargeTrail(ctx, g.players);
  drawChainEffects(ctx, g.chainEffects);
  drawMeteorEffects(ctx, g.meteorEffects);
  drawPendingPulls(ctx, g.pendingPulls);
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
  renderDeathFeed(ctx, g.deathFeed, g.time, H);

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

  // Relic HUD — show collected relic icons below weapons.
  const relicStr = RELICS
    .filter(r => (p.relics[r.id] || 0) > 0)
    .map(r => p.relics[r.id] > 1 ? `${r.icon}x${p.relics[r.id]}` : r.icon)
    .join(' ');
  const relicEl = document.getElementById('hud-relics');
  if (relicEl && relicEl.textContent !== relicStr) relicEl.textContent = relicStr;

  // --- level-up flash ---
  if (g.levelFlash > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform for full-screen overlay
    // Clamp alpha to 0.5 max. Bugfix: boss-phase callers pushed flash(0.6+)
    // which uncapped multiplied past 1.0, producing near-solid yellow
    // "flashbang" frames around wave 43+ where overkill + phase events stack.
    ctx.globalAlpha = Math.min(0.5, g.levelFlash / 0.15 * 0.3);
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

// Mobile invisible touch joystick + page-level touch defaults — both
// shared with MP via shared/joystick.js. analogMove is passed in
// so SP gets analog magnitude reads (weapon aim by heading); MP omits
// the param and only writes boolean keys.
bindTouchJoystick({ canvas, keys, analogMove });

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
  // VFX pass 3 item 1 — advance death transition outside the sim's
  // update(). Death freezes sim state (update() early-returns when
  // !player.alive), but the transition timer needs to keep ticking
  // in real time to reach the 2s showDeathScreen handoff.
  if (game && game.deathTransition) {
    const dt2 = game.deathTransition;
    dt2.t += dt;
    if (dt2.t >= dt2.duration && !dt2.fired) {
      dt2.fired = true;
      showDeathScreen(game);
    }
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
  sessionNewUnlocks = [];
  achievements = loadAchievements(); // refresh in case another tab updated it
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
// toggleMute, setBgmVol, setSfxVol — wired by bootSharedServices() (step 3b).
// toggleVolPanel, showBestiary, hideBestiary — also wired by bootSharedServices().
window.showWeaponHistogram = showWeaponHistogram;
window.hideWeaponHistogram = hideWeaponHistogram;

// --- Top-run weapon frequency (debug / balance view) ---
// Hidden behind `?debug=stats` — not in the main UI because the data
// is survivorship-biased (only /leaderboard top runs, not all picks).
// Opens a modal that fetches recent leaderboard runs and aggregates
// via the shared weaponPickHistogram helper. Rollup toggle collapses
// evolutions into their source pair so a chain+field evolution run
// doesn't drop chain/field off the histogram.
let _wphRuns = null;
async function showWeaponHistogram() {
  const overlay = document.getElementById('weapon-histogram');
  const body = document.getElementById('wph-body');
  const toggle = document.getElementById('wph-rollup-toggle');
  overlay.style.display = 'flex';
  body.innerHTML = '<div class="wph-empty">loading…</div>';
  const render = () => renderWeaponHistogram(body, _wphRuns || [], {
    mode: toggle.checked ? 'rollup' : 'asRecorded',
  });
  // One-shot fetch — modal reopens don't re-hit the endpoint unless
  // the data wasn't loaded last time.
  if (!_wphRuns) {
    try {
      const r = await fetch(`${ANALYTICS_URL}/leaderboard?limit=200`);
      const j = await r.json();
      _wphRuns = Array.isArray(j.entries) ? j.entries : Array.isArray(j) ? j : [];
    } catch {
      _wphRuns = [];
      body.innerHTML = '<div class="wph-empty">offline</div>';
      return;
    }
  }
  toggle.onchange = render;
  render();
}

function hideWeaponHistogram() {
  document.getElementById('weapon-histogram').style.display = 'none';
}

// Auto-open on `?debug=stats` so the view is one URL away for any
// analyst / dev without cluttering the main menu.
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === 'stats') {
    window.addEventListener('DOMContentLoaded', () => showWeaponHistogram());
  }
}

