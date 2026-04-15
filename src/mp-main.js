// ============================================================
// SURVIVORS — multiplayer WebSocket client.
// Thin display layer: server runs all game logic.
// Bundled by scripts/build.cjs → bundle-mp.js (loaded by mp.html).
// ============================================================

import { WEAPON_ICONS } from './shared/weapons.js';
import { escapeHTML } from './shared/htmlEscape.js';
import { buildBackgroundCanvas } from './shared/tileBackground.js';
import { loadObstacleSprites, drawObstacle, drawNeonBackground } from './shared/obstacleSprites.js';
import { MAPS } from './shared/maps.js';
import { loadPrestige } from './shared/prestige.js';
import { makeDrawSprite, drawSkinAura, drawHpBar, drawParticles, drawGem } from './shared/render.js';
import { markSeen, getBestiaryEntries } from './shared/bestiary.js';

// Server validates + caps so we just send what we have. Cosmetics fall
// back to null for never-played users with empty localStorage.
function prestigePayload() {
  const p = loadPrestige();
  return { unlocks: p.unlocks, activeSkin: p.activeSkin, activeTrail: p.activeTrail };
}

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// --- sprite sheet ---
const spriteSheet = new Image();
spriteSheet.src = 'sprites.png';
let spritesReady = false;
spriteSheet.onload = () => { spritesReady = true; };

// Most enemy names match their sprite name; only ghost diverges (uses
// skull sprite). Server doesn't broadcast `sprite`, so we derive it.
const ENEMY_SPRITES = { ghost: 'skull' };

const drawSprite = makeDrawSprite(ctx, spriteSheet, () => spritesReady);

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
        o2.connect(g2); g2.connect(ac.destination);
        o2.type = 'square';
        o2.frequency.setValueAtTime(800, t + 0.03);
        o2.frequency.linearRampToValueAtTime(400, t + 0.1);
        g2.gain.setValueAtTime(0.06, t + 0.03);
        g2.gain.linearRampToValueAtTime(0, t + 0.12);
        o2.start(t + 0.03); o2.stop(t + 0.12);
        break;
      }
      default:
        gain.gain.setValueAtTime(0, t);
        osc.start(t); osc.stop(t + 0.01);
    }
  } catch (e) { /* audio not available */ }
}

// --- battle music (map-aware + mute toggle) ---
const MP_MAP_TRACKS = { neon: 'neon_grid.ogg' };
const MP_DEFAULT_TRACK = 'survivors_battle.ogg';
const MP_MUSIC_VOL = 0.35;
let mpBgMusic = null;
let mpBgMusicGain = null;
let mpMusicFading = false;
let mpCurrentTrack = null;
let mpMusicMuted = false;
try { mpMusicMuted = localStorage.getItem('survivors_mute') === '1'; } catch (_) {}
function updateMpMuteBtn() {
  const b = document.getElementById('mute-btn');
  if (b) b.textContent = mpMusicMuted ? '🔇' : '🔊';
}
updateMpMuteBtn();

function startMpMusic(mapId) {
  try {
    const ac = getAudio();
    if (ac.state === 'suspended') ac.resume();
    const src = MP_MAP_TRACKS[mapId] || MP_DEFAULT_TRACK;
    if (mpBgMusic && mpCurrentTrack !== src) {
      mpBgMusic.pause(); mpBgMusic = null; mpBgMusicGain = null;
    }
    if (!mpBgMusic) {
      mpBgMusic = new Audio();
      mpBgMusic.loop = true;
      mpBgMusic.volume = 1;
      mpBgMusic.src = src;
      mpCurrentTrack = src;
      const mediaSrc = ac.createMediaElementSource(mpBgMusic);
      mpBgMusicGain = ac.createGain();
      mpBgMusicGain.gain.value = 0;
      mediaSrc.connect(mpBgMusicGain);
      mpBgMusicGain.connect(ac.destination);
    }
    mpBgMusic.currentTime = 0;
    mpBgMusic.play().catch(() => {});
    const target = mpMusicMuted ? 0 : MP_MUSIC_VOL;
    mpBgMusicGain.gain.cancelScheduledValues(ac.currentTime);
    mpBgMusicGain.gain.setValueAtTime(0, ac.currentTime);
    mpBgMusicGain.gain.linearRampToValueAtTime(target, ac.currentTime + 2);
    mpMusicFading = false;
  } catch (_) {}
}

function toggleMpMute() {
  mpMusicMuted = !mpMusicMuted;
  try { localStorage.setItem('survivors_mute', mpMusicMuted ? '1' : '0'); } catch (_) {}
  updateMpMuteBtn();
  if (mpBgMusicGain) {
    try {
      const ac = getAudio();
      mpBgMusicGain.gain.cancelScheduledValues(ac.currentTime);
      mpBgMusicGain.gain.linearRampToValueAtTime(mpMusicMuted ? 0 : MP_MUSIC_VOL, ac.currentTime + 0.3);
    } catch (_) {}
  }
}

// --- resize ---
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ============================================================
// NETWORK STATE
// ============================================================

let ws = null;
let myId = null;
let myName = '';
let selectedWeapon = 'spit';
let connected = false;
let arena = { w: 3000, h: 3000 };
let mapId = null;
let obstacles = [];
let bgCanvas = null;

// State interpolation: store previous + current snapshots
let prevState = null;
let currState = null;
let stateTime = 0;      // time we received currState
let interpAlpha = 1;     // 0..1 blend between prev and curr
const TICK_DT = 1 / 20;  // server sends at 20Hz

// Client-side particles (decorative only)
let particles = [];
let screenShake = 0;
// Per-player fire-trail throttle keyed by id. Last position is used to
// detect movement so stationary trail-wearers don't pile particles.
const trailState = new Map();

function spawnFireTrail(pl, dt) {
  let st = trailState.get(pl.id);
  if (!st) { st = { timer: 0, lastX: pl.x, lastY: pl.y }; trailState.set(pl.id, st); }
  const dx = pl.x - st.lastX, dy = pl.y - st.lastY;
  const moved = dx * dx + dy * dy > 0.5;
  st.lastX = pl.x; st.lastY = pl.y;
  st.timer -= dt;
  if (st.timer > 0 || !moved) return;
  st.timer = 0.03; // ~33 particles/sec while moving
  particles.push({
    x: pl.x + (Math.random() - 0.5) * 4,
    y: pl.y + (Math.random() - 0.5) * 4,
    vx: (Math.random() - 0.5) * 30,
    vy: -40 - Math.random() * 60,
    life: 0.3 + Math.random() * 0.3,
    maxLife: 0.6,
    radius: 2 + Math.random() * 2,
    color: Math.random() > 0.4 ? '#f39c12' : '#e74c3c',
  });
}

// Track previous state for change detection (sounds, death, etc.)
let prevMyHp = null;
let prevMyAlive = null;
let prevMyLevel = null;
let prevEnemyCount = 0;
let prevGemCount = 0;

// Camera
let camera = { x: 1500, y: 1500 };

// Spectator: when dead, follow another player
let spectateIdx = 0;

// Input
let keys = { up: false, down: false, left: false, right: false };
let lastSentKeys = null;

function selectWeapon(type) {
  selectedWeapon = type;
  document.querySelectorAll('.weapon-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.weapon === type);
  });
}

// ============================================================
// WEBSOCKET
// ============================================================

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host || 'localhost:7700';
  const url = proto + '//' + host + '/ws';

  const connStatus = document.getElementById('conn-status');
  connStatus.style.display = 'block';
  connStatus.textContent = 'CONNECTING...';

  ws = new WebSocket(url);

  ws.onopen = () => {
    connected = true;
    connStatus.style.display = 'none';
    console.log('[ws] connected');
  };

  ws.onclose = () => {
    connected = false;
    ws = null;
    connStatus.style.display = 'block';
    connStatus.textContent = 'DISCONNECTED — reconnecting...';
    console.log('[ws] disconnected, reconnecting in 2s');
    setTimeout(connectWS, 2000);
  };

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }

    if (msg.type === 'welcome') {
      myId = msg.you;
      myName = msg.name;
      arena = msg.arena || arena;
      // Server sends the map's obstacle list once on join. The list
      // doesn't change mid-game so we don't re-broadcast it in `state`.
      mapId = msg.map ? msg.map.id : null;
      obstacles = msg.map ? msg.map.obstacles : [];
      console.log(`[ws] welcome: id=${myId}, name=${myName}, map=${mapId}`);
      // Load this map's ground tileset (async — falls back to grid).
      buildBackgroundCanvas(mapId).then(c => { bgCanvas = c; }).catch(() => {});
      loadObstacleSprites();
      startMpMusic(mapId);
      return;
    }

    if (msg.type === 'state') {
      prevState = currState;
      currState = msg;
      stateTime = performance.now();
      interpAlpha = 0;
      arena = msg.arena || arena;

      // Detect changes for sound effects
      processStateChanges(msg);
      return;
    }

    if (msg.type === 'levelup') {
      showLevelUpChoices(msg.choices);
      return;
    }
  };
}

// Show the level-up overlay with the three server-supplied choices.
// Click or press 1/2/3 to send a `choose` reply. Auto-pick choice 1
// after 10s so an AFK player doesn't softlock their own overlay.
let levelUpTimeout = null;
function showLevelUpChoices(choices) {
  sfx('levelup');
  const overlay   = document.getElementById('level-up');
  const container = document.getElementById('level-choices');
  container.innerHTML = '';
  overlay.style.display = 'flex';

  window._levelChoices = [];
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    const div = document.createElement('div');
    div.className = 'choice';
    div.innerHTML = `
      <div class="name"><span style="color:#555;font-size:0.6rem">[${i+1}]</span> ${escapeHTML(c.icon)} ${escapeHTML(c.name)}</div>
      <div class="desc">${escapeHTML(c.desc)}</div>
    `;
    const pick = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'choose', choiceId: c.id }));
      overlay.style.display = 'none';
      window._levelChoices = [];
      if (levelUpTimeout) { clearTimeout(levelUpTimeout); levelUpTimeout = null; }
    };
    div.onclick = pick;
    window._levelChoices.push(pick);
    container.appendChild(div);
  }
  if (levelUpTimeout) clearTimeout(levelUpTimeout);
  levelUpTimeout = setTimeout(() => {
    if (window._levelChoices && window._levelChoices[0]) window._levelChoices[0]();
  }, 10000);
}

function processStateChanges(state) {
  const me = state.players.find(p => p.id === myId);
  if (!me) return;

  // HP change -> hit sound
  if (prevMyHp !== null && me.hp < prevMyHp && me.alive) {
    sfx('playerhit');
    screenShake = 0.15;
    spawnParticles(me.x, me.y, '#e74c3c', 5);
  }

  // Death
  if (prevMyAlive === true && !me.alive) {
    sfx('death');
    showDeathScreen(state, me);
  }

  // Level up
  if (prevMyLevel !== null && me.level > prevMyLevel) {
    sfx('levelup');
  }

  // Gem count decreased -> pickup sound (rough heuristic)
  if (state.gems.length < prevGemCount && prevGemCount - state.gems.length <= 3) {
    sfx('xp');
  }

  // Enemy count decreased -> kill sounds (limit to avoid spam)
  const enemyDelta = prevEnemyCount - state.enemies.length;
  if (enemyDelta > 0 && enemyDelta <= 5) {
    sfx('kill');
  }

  prevMyHp = me.hp;
  prevMyAlive = me.alive;
  prevMyLevel = me.level;
  prevEnemyCount = state.enemies.length;
  prevGemCount = state.gems.length;
}

function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const k = JSON.stringify(keys);
  if (k === lastSentKeys) return;
  lastSentKeys = k;
  ws.send(JSON.stringify({ type: 'input', keys: { ...keys } }));
}

// Tracked so a second PLAY click while the first is still polling
// doesn't spawn a parallel timer (the original code leaked one
// setInterval per attempt for the entire session if the connection
// kept failing).
let pendingJoinTimer = null;
const JOIN_TIMEOUT_MS = 10_000;

function joinGame() {
  const nameInput = document.getElementById('name-input');
  const name = (nameInput.value || '').trim().slice(0, 12) || 'player';
  myName = name;

  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('death-screen').style.display = 'none';

  const sendJoin = () => ws.send(JSON.stringify({
    type: 'join', name: myName, weapon: selectedWeapon, prestige: prestigePayload(),
  }));

  if (connected) { sendJoin(); }
  else {
    connectWS();
    if (pendingJoinTimer) clearInterval(pendingJoinTimer);
    const start = Date.now();
    pendingJoinTimer = setInterval(() => {
      if (connected && ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(pendingJoinTimer); pendingJoinTimer = null;
        sendJoin();
      } else if (Date.now() - start > JOIN_TIMEOUT_MS) {
        // Give up after 10s rather than poll forever.
        clearInterval(pendingJoinTimer); pendingJoinTimer = null;
        console.warn('[ws] join timed out after', JOIN_TIMEOUT_MS, 'ms');
      }
    }, 100);
  }

  if (!renderStarted) {
    renderStarted = true;
    requestAnimationFrame(mainLoop);
  }
  // Music starts on first state message (when we know the mapId).
}

function respawnGame() {
  document.getElementById('death-screen').style.display = 'none';
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'respawn', weapon: selectedWeapon, prestige: prestigePayload() }));
  }
  prevMyAlive = null;
  prevMyHp = null;
  prevMyLevel = null;
}

function showDeathScreen(state, me) {
  const mins = Math.floor(state.time / 60);
  const secs = Math.floor(state.time % 60);
  const weaponList = (me.weapons || []).map(w => WEAPON_ICONS[w] || '?').join(' ');
  document.getElementById('death-stats').innerHTML = `
    Survived: ${mins}:${secs.toString().padStart(2, '0')}<br>
    Level: ${me.level} · Wave: ${state.wave}<br>
    Kills: ${me.kills}<br>
    <div style="margin-top:8px;font-size:0.7rem;color:#666">Weapons: ${weaponList}</div>
  `;
  document.getElementById('death-screen').style.display = 'flex';
}

// ============================================================
// CLIENT-SIDE PARTICLES (decorative only)
// ============================================================

function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 150;
    particles.push({
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

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) particles.splice(i, 1);
  }
  if (screenShake > 0) screenShake -= dt;
}

// ============================================================
// INTERPOLATION
// ============================================================

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpState(prev, curr, t) {
  // Interpolate positions of entities between two state snapshots
  if (!prev || !curr) return curr;
  t = Math.min(1, Math.max(0, t));

  const result = { ...curr };

  // Interpolate players
  result.players = curr.players.map(cp => {
    const pp = prev.players.find(p => p.id === cp.id);
    if (!pp) return cp;
    return {
      ...cp,
      x: lerp(pp.x, cp.x, t),
      y: lerp(pp.y, cp.y, t),
      hp: lerp(pp.hp, cp.hp, t),
    };
  });

  // Match by index (server doesn't send enemy IDs); skip lerp if counts
  // differ, and bail per-row if names don't match (a swap that re-used
  // the same slot index between ticks).
  if (prev.enemies.length === curr.enemies.length) {
    result.enemies = curr.enemies.map((ce, i) => {
      const pe = prev.enemies[i];
      if (pe.name !== ce.name) return ce;
      return { ...ce, x: lerp(pe.x, ce.x, t), y: lerp(pe.y, ce.y, t) };
    });
  }

  if (prev.gems.length === curr.gems.length) {
    result.gems = curr.gems.map((cg, i) => {
      const pg = prev.gems[i];
      return { ...cg, x: lerp(pg.x, cg.x, t), y: lerp(pg.y, cg.y, t) };
    });
  }

  // Projectiles: don't interpolate (move fast, short-lived)
  return result;
}

// ============================================================
// RENDER
// ============================================================

let renderStarted = false;
let lastFrameTime = 0;

function mainLoop(ts) {
  const dt = Math.min((ts - lastFrameTime) / 1000, 0.05);
  lastFrameTime = ts;

  // Update interpolation alpha
  if (currState) {
    const elapsed = (performance.now() - stateTime) / 1000;
    interpAlpha = Math.min(elapsed / TICK_DT, 1);
  }

  // Send input
  sendInput();

  // Update client-side effects
  updateParticles(dt);

  // Render
  render(dt);

  requestAnimationFrame(mainLoop);
}

function render(dt) {
  const W = canvas.width;
  const H = canvas.height;

  if (!currState) {
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);
    return;
  }

  const state = lerpState(prevState, currState, interpAlpha);
  const me = state.players.find(p => p.id === myId);

  // Camera target: follow me if alive, otherwise spectate
  let camTarget;
  if (me && me.alive) {
    camTarget = { x: me.x, y: me.y };
  } else {
    // Spectate: find an alive player
    const alive = state.players.filter(p => p.alive);
    if (alive.length > 0) {
      spectateIdx = spectateIdx % alive.length;
      camTarget = { x: alive[spectateIdx].x, y: alive[spectateIdx].y };
    } else {
      camTarget = { x: arena.w / 2, y: arena.h / 2 };
    }
  }

  // Smooth camera — proper exponential decay so smoothing doesn't drift
  // between 30/60/120 fps (the old `Math.pow(0.001, dt)` was framerate-coupled).
  const camSmooth = 1 - Math.exp(-12 * dt);
  camera.x += (camTarget.x - camera.x) * camSmooth;
  camera.y += (camTarget.y - camera.y) * camSmooth;

  ctx.save();
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  let cx = camera.x - W / 2;
  let cy = camera.y - H / 2;

  // Screen shake
  if (screenShake > 0) {
    cx += (Math.random() - 0.5) * 8;
    cy += (Math.random() - 0.5) * 8;
  }

  // Snap to integer pixels — sub-pixel translation causes shimmer on retina.
  ctx.translate(-Math.round(cx), -Math.round(cy));

  // --- background: tiled pattern, neon abstract render, or grid fallback ---
  if (bgCanvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bgCanvas, 0, 0, bgCanvas.width, bgCanvas.height, 0, 0, arena.w, arena.h);
    ctx.imageSmoothingEnabled = true;
  } else if (MAPS[mapId]?.abstractRender === 'neon') {
    drawNeonBackground(ctx, cx, cy, W, H, arena);
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
  ctx.strokeRect(0, 0, arena.w, arena.h);

  // --- map obstacles ---
  for (const obs of obstacles) {
    if (obs.x + obs.w < cx || obs.x > cx + W || obs.y + obs.h < cy || obs.y > cy + H) continue;
    drawObstacle(ctx, obs);
  }

  // --- gems ---
  for (const gem of state.gems) {
    if (gem.x < cx - 20 || gem.x > cx + W + 20 || gem.y < cy - 20 || gem.y > cy + H + 20) continue;
    drawGem(ctx, gem, drawSprite);
  }

  // --- heart drops ---
  for (const h of (state.heartDrops || [])) {
    if (h.x < cx - 20 || h.x > cx + W + 20 || h.y < cy - 20 || h.y > cy + H + 20) continue;
    const bob = Math.sin(h.bobPhase) * 2;
    const fadeAlpha = h.life < 2 ? Math.max(0.2, h.life / 2) : 1;
    if (!drawSprite('heart', h.x, h.y + bob, 0.8, fadeAlpha)) {
      ctx.fillStyle = '#e74c3c';
      ctx.globalAlpha = fadeAlpha;
      ctx.beginPath();
      ctx.arc(h.x, h.y + bob, h.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // --- render weapon auras for ALL players ---
  // Server snapshot ships per-weapon stats (radius/bladeCount/etc) so
  // these auras stay in sync with the actual damage zone after the
  // player picks _up upgrades. Defaults match createWeapon() so old
  // clients keep rendering correctly if the server is rolled back.
  const gameTime = state.time || 0;
  for (const pl of state.players) {
    if (!pl.alive) continue;
    for (const w of (pl.weapons || [])) {
      const wtype = w.type;
      if (wtype === 'breath') {
        const pulse = 1 + Math.sin(gameTime * 3) * 0.1;
        const r = (w.radius || 80) * pulse;
        const grad = ctx.createRadialGradient(pl.x, pl.y, r * 0.3, pl.x, pl.y, r);
        grad.addColorStop(0, 'rgba(230, 126, 34, 0.15)');
        grad.addColorStop(0.7, 'rgba(230, 126, 34, 0.08)');
        grad.addColorStop(1, 'rgba(230, 126, 34, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(230, 126, 34, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
        ctx.stroke();
        // rotating dots
        const numDots = 8;
        const phase = gameTime * 2.1;
        for (let i = 0; i < numDots; i++) {
          const a = phase + (Math.PI * 2 / numDots) * i;
          const dotR = 3 + Math.sin(gameTime * 2 + i) * 1.5;
          ctx.globalAlpha = 0.6 + Math.sin(gameTime + i * 0.8) * 0.3;
          ctx.fillStyle = '#e67e22';
          ctx.beginPath();
          ctx.arc(pl.x + Math.cos(a) * r, pl.y + Math.sin(a) * r, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (wtype === 'dragon_storm') {
        const pulse = 1 + Math.sin(gameTime * 4) * 0.1;
        const r = (w.auraRadius || 100) * pulse;
        const grad = ctx.createRadialGradient(pl.x, pl.y, r * 0.2, pl.x, pl.y, r);
        grad.addColorStop(0, 'rgba(243, 156, 18, 0.2)');
        grad.addColorStop(0.6, 'rgba(231, 76, 60, 0.1)');
        grad.addColorStop(1, 'rgba(231, 76, 60, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(243, 156, 18, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (wtype === 'orbit') {
        const bladeCount = w.bladeCount || 2;
        const orbitRadius = w.radius || 70;
        const phase = gameTime * 3;
        for (let b = 0; b < bladeCount; b++) {
          const angle = phase + (b * Math.PI * 2 / bladeCount);
          const bx = pl.x + Math.cos(angle) * orbitRadius;
          const by = pl.y + Math.sin(angle) * orbitRadius;
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(angle + Math.PI / 2);
          ctx.fillStyle = '#ecf0f1';
          ctx.shadowColor = '#ecf0f1';
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
      if (wtype === 'shield') {
        const r = w.radius || 35;
        const grad = ctx.createRadialGradient(pl.x, pl.y, r * 0.7, pl.x, pl.y, r);
        grad.addColorStop(0, 'rgba(52, 152, 219, 0)');
        grad.addColorStop(0.7, 'rgba(52, 152, 219, 0.15)');
        grad.addColorStop(1, 'rgba(52, 152, 219, 0.35)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(52, 152, 219, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (wtype === 'lightning_field') {
        const r = w.radius || 140;
        const a = 0.04 + Math.sin(gameTime * 6) * 0.02;
        ctx.fillStyle = `rgba(241, 196, 15, ${a})`;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(241, 196, 15, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (wtype === 'thunder_god') {
        const r = w.fieldRadius || 180;
        const a = 0.06 + Math.sin(gameTime * 8) * 0.03;
        ctx.fillStyle = `rgba(0, 210, 211, ${a})`;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 210, 211, 0.3)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (wtype === 'meteor_orbit') {
        const bladeCount = w.bladeCount || 4;
        const orbitRadius = w.radius || 90;
        const phase = gameTime * 4;
        for (let b = 0; b < bladeCount; b++) {
          const angle = phase + (b * Math.PI * 2 / bladeCount);
          const bx = pl.x + Math.cos(angle) * orbitRadius;
          const by = pl.y + Math.sin(angle) * orbitRadius;
          for (let t = 1; t <= 3; t++) {
            const ta = angle - t * 0.1;
            const tx = pl.x + Math.cos(ta) * orbitRadius;
            const ty = pl.y + Math.sin(ta) * orbitRadius;
            ctx.globalAlpha = 0.3 / t;
            ctx.fillStyle = '#ff6348';
            ctx.beginPath();
            ctx.arc(tx, ty, 4 - t, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(angle + Math.PI / 2);
          ctx.fillStyle = '#ff6348';
          ctx.shadowColor = '#ff6348';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(0, -14);
          ctx.lineTo(6, 6);
          ctx.lineTo(-6, 6);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }
      if (wtype === 'fortress') {
        const r = (w.shieldRadius || 80) * (1 + Math.sin(gameTime * 4) * 0.08);
        const grad = ctx.createRadialGradient(pl.x, pl.y, r * 0.7, pl.x, pl.y, r);
        grad.addColorStop(0, 'rgba(116, 185, 255, 0)');
        grad.addColorStop(0.8, 'rgba(116, 185, 255, 0.18)');
        grad.addColorStop(1, 'rgba(116, 185, 255, 0.35)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(116, 185, 255, 0.8)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let h = 0; h < 6; h++) {
          const a = gameTime * 1.2 + (Math.PI * 2 / 6) * h;
          const x = pl.x + Math.cos(a) * r;
          const y = pl.y + Math.sin(a) * r;
          if (h === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  // --- enemies ---
  for (const e of state.enemies) {
    if (e.x < cx - 50 || e.x > cx + W + 50 || e.y < cy - 50 || e.y > cy + H + 50) continue;
    markSeen(e.name, state.wave); // bestiary discovery

    const spriteScale = e.radius / 8;
    const spriteName = ENEMY_SPRITES[e.name] || e.name;

    if (e.hitFlash > 0) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (!drawSprite(spriteName, e.x, e.y, spriteScale)) {
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (e.hp < e.maxHp) {
      drawHpBar(ctx, e.x, e.y - e.radius - 8, e.radius * 2, e.hp / e.maxHp, 3, '#300');
    }
  }

  // --- projectiles ---
  for (const proj of state.projectiles) {
    if (proj.x < cx - 30 || proj.x > cx + W + 30 || proj.y < cy - 30 || proj.y > cy + H + 30) continue;

    // Find owner color
    let projColor = '#9b59b6';
    const owner = state.players.find(p => p.id === proj.owner);
    if (owner) projColor = owner.color;

    ctx.shadowColor = projColor;
    ctx.shadowBlur = 10;
    if (!drawSprite('spit', proj.x, proj.y, 0.7)) {
      ctx.fillStyle = projColor;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius || 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // --- chain effects (chain lightning bolts + lightning_field zaps) ---
  for (const ce of (state.chainEffects || [])) {
    const alpha = Math.max(0, Math.min(1, ce.life / 0.2));
    ctx.strokeStyle = ce.color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.shadowColor = ce.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(ce.points[0].x, ce.points[0].y);
    for (let i = 1; i < ce.points.length; i++) ctx.lineTo(ce.points[i].x, ce.points[i].y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // --- meteor effects (warn ring then explosion flash) ---
  for (const m of (state.meteorEffects || [])) {
    if (m.x < cx - m.radius || m.x > cx + W + m.radius || m.y < cy - m.radius || m.y > cy + H + m.radius) continue;
    if (m.phase === 'warn') {
      const a = 0.5 + Math.sin(gameTime * 12) * 0.3;
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = a;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      const a = Math.max(0, Math.min(1, m.life / 0.3));
      ctx.fillStyle = m.color;
      ctx.globalAlpha = a * 0.5;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // --- players ---
  for (const pl of state.players) {
    if (!pl.alive) continue;

    const isMe = pl.id === myId;
    if (pl.x < cx - 60 || pl.x > cx + W + 60 || pl.y < cy - 60 || pl.y > cy + H + 60) continue;
    const playerRadius = 14;
    const skin = pl.activeSkin;

    drawSkinAura(ctx, pl.x, pl.y, playerRadius, skin, gameTime);

    // Glow color tracks skin.
    const glowColor = skin === 'skin_gold' ? '#f39c12'
                    : skin === 'skin_shadow' ? '#9b59b6'
                    : (isMe ? '#3498db' : pl.color);
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = skin === 'skin_shadow' ? 25 : (isMe ? 15 : 8);

    // Player sprite/circle
    const spriteDrawn = drawSprite('player', pl.x, pl.y, 2);
    if (spriteDrawn && skin) {
      // Skin tint overlay.
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      const tintColor = skin === 'skin_gold' ? 'rgba(241, 196, 15, 0.35)'
                      : 'rgba(100, 30, 150, 0.4)';
      ctx.fillStyle = tintColor;
      ctx.fillRect(pl.x - 16, pl.y - 16, 32, 32);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
    if (!spriteDrawn) {
      ctx.fillStyle = pl.color;
      ctx.beginPath();
      ctx.arc(pl.x, pl.y, playerRadius, 0, Math.PI * 2);
      ctx.fill();
      if (isMe) {
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;

    // Fire trail particles. Spawned local-only so we don't have to add
    // a particle channel to the WS protocol — visible to whoever's
    // watching the wearer. Keyed by player id so each wearer has its
    // own throttle bucket.
    if (pl.activeTrail === 'trail_fire') spawnFireTrail(pl, dt);

    // "YOU" indicator - arrow above self
    if (isMe) {
      ctx.fillStyle = '#3498db';
      ctx.globalAlpha = 0.7 + Math.sin(gameTime * 4) * 0.3;
      ctx.beginPath();
      const ay = pl.y - playerRadius - 28;
      ctx.moveTo(pl.x, ay + 6);
      ctx.lineTo(pl.x - 5, ay);
      ctx.lineTo(pl.x + 5, ay);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Name tag
    ctx.fillStyle = isMe ? '#fff' : '#ccc';
    ctx.font = `bold 9px "Chakra Petch", sans-serif`;
    ctx.textAlign = 'center';
    ctx.globalAlpha = isMe ? 1 : 0.7;
    ctx.fillText(pl.name, pl.x, pl.y - playerRadius - 18);
    ctx.globalAlpha = 1;

    // Level badge
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 7px "Chakra Petch", sans-serif';
    ctx.globalAlpha = 0.6;
    ctx.fillText('Lv' + pl.level, pl.x, pl.y + playerRadius + 14);
    ctx.globalAlpha = 1;

    drawHpBar(ctx, pl.x, pl.y - playerRadius - 10, 30, pl.hp / pl.maxHp);
  }

  drawParticles(ctx, particles);

  ctx.restore();

  // --- spectator label ---
  if (me && !me.alive) {
    const alive = state.players.filter(p => p.alive);
    if (alive.length > 0) {
      ctx.fillStyle = 'rgba(170, 170, 170, 0.7)';
      ctx.font = '12px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      const specName = alive[spectateIdx % alive.length].name;
      ctx.fillText(`SPECTATING: ${specName} (click to switch)`, W / 2, H - 30);
    }
  }

  // --- wave banner (regular + special) ---
  if (state.waveMsg && state.waveMsgTimer > 0) {
    const alpha = Math.min(1, state.waveMsgTimer / 0.5);
    ctx.fillStyle = `rgba(241, 196, 15, ${alpha})`;
    ctx.font = 'bold 32px "Orbitron", "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(241, 196, 15, 0.6)';
    ctx.shadowBlur = 16;
    ctx.fillText(state.waveMsg, W / 2, H * 0.3);
    ctx.shadowBlur = 0;
  }
  if (state.specialWaveMsg && state.specialWaveMsgTimer > 0) {
    const alpha = Math.min(1, state.specialWaveMsgTimer / 0.5);
    ctx.fillStyle = `rgba(231, 76, 60, ${alpha})`;
    ctx.font = 'bold 18px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`⚠ ${state.specialWaveMsg} ⚠`, W / 2, H * 0.3 + 44);
  }

  // --- death feed (bottom-left) ---
  const recent = (state.deathFeed || []);
  for (let i = 0; i < recent.length; i++) {
    const entry = recent[i];
    const age = state.time - entry.time;
    if (age > 6) continue;
    const alpha = age > 5 ? (6 - age) : 1;
    ctx.fillStyle = `rgba(204, 204, 204, ${alpha * 0.7})`;
    ctx.font = '10px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(entry.text, 12, H - 20 - (recent.length - 1 - i) * 16);
  }

  // --- HUD ---
  if (state) {
    const mins = Math.floor(state.time / 60);
    const secs = Math.floor(state.time % 60);
    document.getElementById('hud-time').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('hud-players').textContent = `${state.players.length} player${state.players.length !== 1 ? 's' : ''}`;
    document.getElementById('hud-kills').textContent = `${state.kills} kills`;
    document.getElementById('hud-wave').textContent = `Wave ${state.wave}`;
    if (me) {
      document.getElementById('hud-weapons').textContent = (me.weapons || []).map(w => WEAPON_ICONS[w] || '?').join(' ');
      document.getElementById('hud-level').textContent = `Lv ${me.level}`;
      const xpFill = document.getElementById('xp-fill');
      if (xpFill) xpFill.style.width = `${Math.min(100, (me.xp / me.xpToLevel) * 100)}%`;
    }
  }
}

// ============================================================
// INPUT
// ============================================================

const KEY_MAP = {
  'w': 'up', 'arrowup': 'up',
  's': 'down', 'arrowdown': 'down',
  'a': 'left', 'arrowleft': 'left',
  'd': 'right', 'arrowright': 'right',
};

document.addEventListener('keydown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  // Number keys 1-3 pick a level-up choice when the overlay is open.
  // The handlers in window._levelChoices send the `choose` message and
  // hide the overlay themselves.
  if (window._levelChoices && window._levelChoices.length > 0 && /^[1-3]$/.test(e.key)) {
    const idx = Number(e.key) - 1;
    const pick = window._levelChoices[idx];
    if (pick) { pick(); e.preventDefault(); return; }
  }
  const k = KEY_MAP[e.key.toLowerCase()];
  if (k) { keys[k] = true; e.preventDefault(); }
});

document.addEventListener('keyup', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  const k = KEY_MAP[e.key.toLowerCase()];
  if (k) { keys[k] = false; e.preventDefault(); }
});

// Keyboard shortcuts for start/death screens
document.addEventListener('keydown', e => {
  const startScreen = document.getElementById('start-screen');
  const deathScreen = document.getElementById('death-screen');
  const startVisible = startScreen.style.display !== 'none' && startScreen.offsetParent !== null;
  const deathVisible = deathScreen.style.display === 'flex';
  if (startVisible) {
    if (e.key === '1') selectWeapon('spit');
    else if (e.key === '2') selectWeapon('breath');
    else if (e.key === '3') selectWeapon('charge');
    else if (e.key === 'Enter' || e.key === ' ') { joinGame(); e.preventDefault(); }
  }
  if (deathVisible) {
    if (e.key === '1') selectWeapon('spit');
    else if (e.key === '2') selectWeapon('breath');
    else if (e.key === '3') selectWeapon('charge');
    else if (e.key === 'Enter' || e.key === ' ') { respawnGame(); e.preventDefault(); }
  }
});

// Click to switch spectate target
canvas.addEventListener('click', () => {
  if (currState) {
    const me = currState.players.find(p => p.id === myId);
    if (me && !me.alive) {
      spectateIdx++;
    }
  }
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
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    if (dist > JOY_DEAD) {
      keys.left = nx < -0.4;
      keys.right = nx > 0.4;
      keys.up = ny < -0.4;
      keys.down = ny > 0.4;
    } else {
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
    keys.left = keys.right = keys.up = keys.down = false;
  }
}
joyZone.addEventListener('touchend', joyEnd, { passive: false });
joyZone.addEventListener('touchcancel', joyEnd, { passive: false });

document.addEventListener('touchmove', e => {
  if (e.target === canvas || e.target === joyZone || joyZone.contains(e.target)) {
    e.preventDefault();
  }
}, { passive: false });

let lastTap = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTap < 300) e.preventDefault();
  lastTap = now;
}, { passive: false });

document.addEventListener('contextmenu', e => e.preventDefault());

// Focus name input on load
window.addEventListener('load', () => {
  document.getElementById('name-input').focus();
});

// Expose handlers used by inline HTML.
// Both PLAY and RETRY use `onclick="startGame()"` in template.html — alias
// to joinGame on first press, respawnGame after death.
window.startGame = () => (renderStarted && prevMyAlive === false ? respawnGame() : joinGame());
window.selectWeapon = selectWeapon;
window.toggleMute = toggleMpMute;
window.showBestiary = showBestiary;
window.hideBestiary = hideBestiary;

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
