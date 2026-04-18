// ============================================================
// SURVIVORS — multiplayer WebSocket client.
// Thin display layer: server runs all game logic.
// Bundled by scripts/build.cjs → bundle-mp.js (loaded by mp.html).
// ============================================================

import { WEAPON_ICONS } from './shared/weapons.js';
import { decorateWeaponCard } from './shared/levelUpCard.js';
import { renderDeathHighlights } from './shared/deathHighlights.js';
import { bindResize } from './shared/viewport.js';
import { bindTouchJoystick } from './shared/joystick.js';
import { PLAYER_RADIUS } from './shared/constants.js';
import { sfx, getSfxVol, getAudioCtx as getAudio } from './shared/sfx.js';
import { installKeyboardInput } from './shared/input.js';
import { initMusic } from './shared/musicDirector.js';
// clampSliderVol import removed — setSfxVol now lives in boot.js (step 3b)
import { escapeHTML } from './shared/htmlEscape.js';
import { buildBackgroundCanvas } from './shared/tileBackground.js';
import { loadObstacleSprites, drawObstacle } from './shared/obstacleSprites.js';
import { drawBackground } from './shared/backgroundRenderer.js';
import { MAPS } from './shared/maps.js';
import { loadPrestige } from './shared/prestige.js';
import { makeDrawSprite, drawHpBar, drawParticles, drawFloatingTexts, drawChainEffects, drawMeteorEffects, drawPendingPulls, drawPlayerBody, drawFacingIndicator, drawChargeTrail, spawnFireTrail, renderWorld } from './shared/render.js';
import { getAmbient } from './shared/mapAmbient.js';
import { applySimEvent, resetParticleOverflow, safeParticlePush } from './shared/simEventHandler.js';
import { markSeen } from './shared/bestiary.js';
// showBestiary + hideBestiary moved to shared/boot.js
import { loadAchievements, ACHIEVEMENTS } from './shared/achievements.js';
import { createBaseGameState } from './shared/gameState.js';
import { renderDeathFeed } from './shared/deathFeed.js';
import { RELICS } from './shared/relics.js';
import { createWeaponPicker } from './shared/weaponPicker.js';
import { powerupIconHTML } from './shared/sprites.js';

// Server validates + caps so we just send what we have. Cosmetics fall
// back to null for never-played users with empty localStorage.
function prestigePayload() {
  const p = loadPrestige();
  return { unlocks: p.unlocks, activeSkin: p.activeSkin, activeTrail: p.activeTrail };
}

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// Minimap overlay — fixed bottom-right, MP-only spatial awareness for
// 8-player games. Pure client; reads from currState which renderWorld
// is already drawing from.
const mmCanvas = document.createElement('canvas');
const MM = 140;
// mmBorderUntil: performance.now() timestamp until which the minimap
// border should pulse red — set by the bossPhase phase-3 event.
let mmBorderUntil = 0;
mmCanvas.width = mmCanvas.height = MM;
Object.assign(mmCanvas.style, {
  position: 'fixed', bottom: '12px', right: '12px',
  width: MM + 'px', height: MM + 'px',
  borderRadius: '4px', pointerEvents: 'none', zIndex: '50',
});
document.body.appendChild(mmCanvas);
const mmCtx = mmCanvas.getContext('2d');

function drawMinimap() {
  if (!currState) return;
  const { players = [], enemies = [], gems = [], consumables = [] } = currState;
  const aw = (arena && arena.w) || 3000;
  const ah = (arena && arena.h) || 3000;
  const sx = MM / aw, sy = MM / ah;

  mmCtx.clearRect(0, 0, MM, MM);
  mmCtx.fillStyle = 'rgba(0,0,0,0.55)';
  mmCtx.fillRect(0, 0, MM, MM);

  // Trash gems as tiny blue pixels; tier-1 (elite) get purple,
  // tier-2 (boss) get bigger gold dots so players spot high-value
  // pickups across the map.
  for (const g of gems) {
    if (g.tier === 2) {
      mmCtx.fillStyle = '#f1c40f';
      mmCtx.fillRect(g.x * sx - 1, g.y * sy - 1, 2, 2);
    } else if (g.tier === 1) {
      mmCtx.fillStyle = '#9b59b6';
      mmCtx.fillRect(g.x * sx - 0.5, g.y * sy - 0.5, 1.5, 1.5);
    } else {
      mmCtx.fillStyle = '#5dade2';
      mmCtx.fillRect(g.x * sx - 0.5, g.y * sy - 0.5, 1, 1);
    }
  }

  // Enemies — gray dots for trash mobs, scaled colored dots for
  // named threats (brute/elite/spawner/boss/healer/bomber) so players
  // can locate bigger enemies at a glance. Boss + healer + bomber
  // each get a pulsing halo since they're priority targets:
  //   boss   — fires ranged spreads, drives the fight
  //   healer — restores 8 HP/1.5s to the pack, MUST die first
  //   bomber — death blast hits the player, plan disengage
  const now = performance.now();
  const bossPulse   = 0.4 + Math.sin(now / 180) * 0.3;
  const healerPulse = 0.35 + Math.sin(now / 280) * 0.25;
  const bomberPulse = 0.45 + Math.sin(now / 140) * 0.3;
  for (const e of enemies) {
    if (e.name === 'boss') {
      mmCtx.fillStyle = e.color || '#d63031';
      mmCtx.beginPath();
      mmCtx.arc(e.x * sx, e.y * sy, 4, 0, Math.PI * 2);
      mmCtx.fill();
      mmCtx.strokeStyle = e.color || '#d63031';
      mmCtx.globalAlpha = bossPulse;
      mmCtx.lineWidth = 1;
      mmCtx.beginPath();
      mmCtx.arc(e.x * sx, e.y * sy, 7, 0, Math.PI * 2);
      mmCtx.stroke();
      mmCtx.globalAlpha = 1;
    } else if (e.name === 'healer') {
      // Calm slow pulse — the visual signals "support", different
      // cadence from boss/bomber so the eye can sort priorities.
      mmCtx.fillStyle = e.color || '#00b894';
      mmCtx.beginPath();
      mmCtx.arc(e.x * sx, e.y * sy, 3, 0, Math.PI * 2);
      mmCtx.fill();
      mmCtx.strokeStyle = e.color || '#00b894';
      mmCtx.globalAlpha = healerPulse;
      mmCtx.lineWidth = 1;
      mmCtx.beginPath();
      mmCtx.arc(e.x * sx, e.y * sy, 6, 0, Math.PI * 2);
      mmCtx.stroke();
      mmCtx.globalAlpha = 1;
    } else if (e.name === 'bomber') {
      // Faster pulse — danger cue. Outer ring approximates the death
      // blast radius (55u world → scaled to minimap) so players know
      // how far to back off before finishing one.
      mmCtx.fillStyle = e.color || '#e17055';
      mmCtx.beginPath();
      mmCtx.arc(e.x * sx, e.y * sy, 3, 0, Math.PI * 2);
      mmCtx.fill();
      mmCtx.strokeStyle = e.color || '#e17055';
      mmCtx.globalAlpha = bomberPulse;
      mmCtx.lineWidth = 1;
      mmCtx.beginPath();
      mmCtx.arc(e.x * sx, e.y * sy, Math.max(5, 55 * sx), 0, Math.PI * 2);
      mmCtx.stroke();
      mmCtx.globalAlpha = 1;
    } else if (e.name === 'elite' || e.name === 'spawner' || e.name === 'brute') {
      mmCtx.fillStyle = e.color || '#888';
      mmCtx.beginPath();
      mmCtx.arc(e.x * sx, e.y * sy, 2.5, 0, Math.PI * 2);
      mmCtx.fill();
    } else {
      mmCtx.fillStyle = '#888';
      mmCtx.beginPath();
      mmCtx.arc(e.x * sx, e.y * sy, 1.5, 0, Math.PI * 2);
      mmCtx.fill();
    }
  }

  // Consumables — rare drops (boss 50%, elite 6%, brute 4%). Pulse
  // with a halo so players actually spot them across the map; use
  // the consumable color so bomb/shield/magnet are distinguishable
  // at a glance.
  if (consumables.length > 0) {
    const pulse = 0.6 + Math.sin(performance.now() / 200) * 0.4;
    for (const c of consumables) {
      const cx = c.x * sx, cy = c.y * sy;
      mmCtx.fillStyle = c.color || '#f39c12';
      mmCtx.beginPath();
      mmCtx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      mmCtx.fill();
      mmCtx.strokeStyle = c.color || '#f39c12';
      mmCtx.globalAlpha = pulse;
      mmCtx.lineWidth = 1;
      mmCtx.beginPath();
      mmCtx.arc(cx, cy, 5, 0, Math.PI * 2);
      mmCtx.stroke();
      mmCtx.globalAlpha = 1;
    }
  }

  for (const p of players) {
    if (!p.alive) continue;
    const mx = p.x * sx, my = p.y * sy;
    const isYou = p.id === myId;
    const r = isYou ? 4 : 3;
    mmCtx.fillStyle = p.color || '#ffffff';
    mmCtx.beginPath();
    mmCtx.arc(mx, my, r, 0, Math.PI * 2);
    mmCtx.fill();
    if (isYou) {
      mmCtx.strokeStyle = '#ffffff';
      mmCtx.lineWidth = 1;
      mmCtx.beginPath();
      mmCtx.arc(mx, my, r + 2, 0, Math.PI * 2);
      mmCtx.stroke();
    }
    // Cyan ring on spectated player so you can track them on the map.
    if (!isYou && spectateId !== null && p.id === spectateId) {
      mmCtx.strokeStyle = '#00e5ff';
      mmCtx.lineWidth = 1.5;
      mmCtx.beginPath();
      mmCtx.arc(mx, my, r + 3, 0, Math.PI * 2);
      mmCtx.stroke();
    }
  }

  // Minimap border — flashes red on boss phase-3 transition, then
  // fades back to the standard dim white over the flash duration.
  // `now` already declared above for the threat-pulse cadences.
  const borderFlashAlpha = mmBorderUntil > now
    ? Math.min(0.9, (mmBorderUntil - now) / 600) // fade out over 600 ms
    : 0;
  if (borderFlashAlpha > 0) {
    mmCtx.strokeStyle = `rgba(220,40,40,${borderFlashAlpha})`;
    mmCtx.lineWidth = 2;
    mmCtx.strokeRect(1, 1, MM - 2, MM - 2);
  }
  mmCtx.strokeStyle = `rgba(255,255,255,${0.3 - borderFlashAlpha * 0.2})`;
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(0.5, 0.5, MM - 1, MM - 1);
}

// Kill feed — drawn in screen-space (not world-space), top-left below
// the wave counter DOM element. Boss/elite/brute/spawner kills only.
function drawKillFeed(ctx) {
  if (!killFeed.length) return;

  const x = 12;
  let y = 52; // below wave counter (~32px) + gap
  const lineH = 18;

  ctx.save();
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';

  for (const entry of killFeed) {
    const alpha = Math.min(1, entry.life / 0.8); // fade out over last 0.8s

    // Colored dot representing the killer's team color.
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = entry.color;
    ctx.beginPath();
    ctx.arc(x + 4, y - 4, 4, 0, Math.PI * 2);
    ctx.fill();

    // Kill text.
    ctx.fillStyle = '#ffffff';
    ctx.fillText(entry.text, x + 12, y);

    y += lineH;
  }

  ctx.restore();
}

// Compact kill-count scoreboard, top-right just above the minimap.
// Only renders when there are 2+ players in the session.
function drawScoreboard(ctx) {
  if (!currState?.players || currState.players.length < 2) return;

  const players = [...currState.players].sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0));
  const mmRight = ctx.canvas.width - 12;      // flush with right edge
  const mmTop   = ctx.canvas.height - 12 - MM; // top of minimap

  ctx.save();
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';

  let y = mmTop - players.length * 16 - 6;
  for (const p of players) {
    ctx.globalAlpha = p.alive ? 1.0 : 0.4;
    ctx.fillStyle = p.color || '#ffffff';
    ctx.fillText(`${p.name}  ${p.kills ?? 0}k`, mmRight, y);
    y += 16;
  }

  ctx.restore();
}

// --- sprite sheet ---
const spriteSheet = new Image();
spriteSheet.src = 'sprites.png';
let spritesReady = false;
spriteSheet.onload = () => { spritesReady = true; };

const drawSprite = makeDrawSprite(ctx, spriteSheet, () => spritesReady);

// --- battle music (singleton — created by boot.js, retrieved here) ---
const music = initMusic({ hasMenu: false });
const { startBattleMusic: startMpMusic } = music;

bindResize(canvas);

// ============================================================
// NETWORK STATE
// ============================================================

let ws = null;
let myId = null;
let myName = '';
// Weapon picker state + keyboard hotkeys shared with SP via
// `shared/weaponPicker.js`. MP omits `onSelect` — audio unlock is
// handled via the PLAY button flow, not weapon selection.
const weaponPicker = createWeaponPicker({ initial: 'spit' });
let connected = false;
let arena = { w: 3000, h: 3000 };
let mapId = null;
let obstacles = [];
let bgCanvas = null;

// Lobby phase — shown after join, before server sends 'welcome'.
let inLobby = false;
let lobbyData = null; // { countdown, mapOptions, votes, playerCount }
let myMapVote = null;

// State interpolation: store previous + current snapshots
let prevState = null;
let currState = null;
let stateTime = 0;      // time we received currState
let interpAlpha = 1;     // 0..1 blend between prev and curr
const TICK_DT = 1 / 20;  // server sends at 20Hz

// Client-side visual state — same zero-shape as SP (main.js). SP owns
// these inside the game object; MP owns them at module scope since
// there's no client-side game object (server drives all sim state).
// Arrays are live references; scalars are copied to mutable lets.
const _clientBase = createBaseGameState();
let { particles, floatingTexts } = _clientBase;
let screenShake = _clientBase.screenShake;
// fork #19 — level-up white-wash flash, parity with SP (src/main.js).
// Driven by applySimEvent → mpEventClient.flash(v). Decays each frame
// in render() and paints a yellow full-screen overlay while >0.
let levelFlash = _clientBase.levelFlash;
// Per-player fire-trail throttle, shared helper owns the write — we
// just own the Map so state survives between render frames.
const trailState = new Map();

// Kill feed — notable enemy kills (boss/elite/brute/spawner only).
// Client-side, populated from enemyKilled sim events.
let killFeed = []; // { text, color, life, maxLife }
const KILLFEED_MAX = 6;
const KILLFEED_LIFE = 4.0; // seconds

// Drain a batch of sim events shipped on the state snapshot. Mirrors
// SP's handleSimEvent but scoped to what makes sense as a peer
// MP event-client shim — drains state.events via the shared
// applySimEvent. No onLevelUp override since the server routes
// level-up choices via a separate 'levelup' message.
const mpEventClient = {
  particles,
  floatingTexts,
  sfx,
  shake(v) { screenShake = Math.max(screenShake, v); },
  flash(v) { levelFlash = Math.max(levelFlash, v); },
  isMe: (pid) => pid === myId,
  // Suppress levelup sfx through the event path — the separate
  // `levelup` server message already triggers it via
  // showLevelUpChoices. Without this override, shared applySimEvent
  // falls through to sfx('levelup') and the leveling player hears
  // the cue twice.
  onLevelUp: () => {},
  // Pulse the minimap border red for `dur` seconds — called by the
  // bossPhase phase-3 handler in simEventHandler.
  minimapBorderFlash(dur) { mmBorderUntil = performance.now() + dur * 1000; },
  // Death-screen DOM flip — only the local player. Event has pid;
  // we look me up on currState (set just before this event drains
  // so it's the same snapshot the death came from).
  onPlayerDeath(evt) {
    if (evt.pid !== myId || !currState) return;
    iDied = true;
    // Start spectating if anyone alive, else show death screen immediately.
    const alive = currState.players.filter(p => p.alive && p.id !== myId);
    if (alive.length > 0) {
      spectateId = alive[0].id;
      showSpectateOverlay(spectateId);
    } else {
      const me = currState.players.find(p => p.id === myId);
      if (me) showDeathScreen(currState, me);
    }
  },
};

// Set true on local-player death event, cleared on join/respawn.
// startGame() reads this to choose join vs respawn for the same
// PLAY/RETRY button.
let iDied = false;

// Camera
let camera = { x: 1500, y: 1500 };

// Spectator: when dead, follow another player by ID (not index —
// index-based tracking breaks when the alive-list reorders between frames).
let spectateId = null;

// Input
let keys = { up: false, down: false, left: false, right: false };
let lastSentKeys = null;

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

    if (msg.type === 'lobbyState') {
      inLobby = true;
      lobbyData = msg;
      renderLobby();
      return;
    }

    if (msg.type === 'welcome') {
      // Hide lobby overlay when game actually starts.
      inLobby = false;
      lobbyData = null;
      myMapVote = null;
      const lobbyEl = document.getElementById('mp-lobby');
      if (lobbyEl) lobbyEl.style.display = 'none';

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

      // Drain sim events shipped with the snapshot. Same channel SP
      // consumes — shared applySimEvent handles both modes via the
      // client shim (mpEventClient).
      if (msg.events) {
        resetParticleOverflow(); // one overflow log per snapshot drain
        for (const evt of msg.events) {
          // Intercept notable kills for the client-side kill feed before
          // delegating to applySimEvent. currState is already set above so
          // we can look up the killer by id.
          if (evt.type === 'enemyKilled') {
            const label = evt.name === 'boss'    ? '☠ Boss'
                        : evt.name === 'elite'   ? '★ Elite'
                        : evt.name === 'brute'   ? 'Brute'
                        : evt.name === 'spawner' ? 'Spawner'
                        : null; // skip trash mobs — too noisy
            if (label) {
              const killer = currState.players.find(p => p.id === evt.killer);
              if (killer) {
                killFeed.unshift({
                  text: `${killer.name} killed ${label}`,
                  color: killer.color || '#ffffff',
                  life: KILLFEED_LIFE,
                  maxLife: KILLFEED_LIFE,
                });
                if (killFeed.length > KILLFEED_MAX) killFeed.pop();
              }
            }
          }
          applySimEvent(evt, mpEventClient);
        }
      }

      // Evict trailState entries for players who have disconnected —
      // otherwise the map grows unbounded over a long-running server.
      if (trailState.size > msg.players.length) {
        const live = new Set(msg.players.map(p => p.id));
        for (const id of trailState.keys()) if (!live.has(id)) trailState.delete(id);
      }

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
    const isEvo = !!c.requiresEvo;
    const div = document.createElement('div');
    div.className = 'choice' + (isEvo ? ' choice--evo' : '');
    div.innerHTML = `
      <div class="name"><span style="color:#555;font-size:0.6rem">[${i+1}]</span> ${powerupIconHTML(c.id, escapeHTML(c.icon))} ${escapeHTML(c.name)}</div>
      <div class="desc">${escapeHTML(c.desc)}</div>
    `;
    if (isEvo) {
      const badge = document.createElement('div');
      badge.className = 'choice-evo-badge';
      badge.textContent = '✦ EVOLUTION';
      div.prepend(badge);
    }
    // Weapon preview (role chip + evo source icons) — shared with SP.
    // Pass local player's weapon loadout so isEvoReady can mark badges.
    const myWeapons = currState?.players.find(p => p.id === myId)?.weapons ?? [];
    const preview = decorateWeaponCard(div, c, myWeapons);
    const statText = (preview && preview.stats) || c.stats || '';
    if (statText) {
      const statsEl = document.createElement('div');
      statsEl.className = 'choice-stats';
      statsEl.textContent = statText;
      div.appendChild(statsEl);
    }
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
  iDied = false;
  // Reset lobby state for fresh join.
  inLobby = false;
  lobbyData = null;
  myMapVote = null;
  const lobbyEl = document.getElementById('mp-lobby');
  if (lobbyEl) lobbyEl.style.display = 'none';

  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('death-screen').style.display = 'none';

  const sendJoin = () => ws.send(JSON.stringify({
    type: 'join', name: myName, weapon: weaponPicker.get(), prestige: prestigePayload(),
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
  spectateId = null;
  const hud = document.getElementById('spectate-hud');
  if (hud) hud.style.display = 'none';
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'respawn', weapon: weaponPicker.get(), prestige: prestigePayload() }));
  }
  iDied = false;
}

function showDeathScreen(state, me) {
  const mins = Math.floor(state.time / 60);
  const secs = Math.floor(state.time % 60);
  const weaponList = (me.weapons || []).map(w => WEAPON_ICONS[w.type] || '?').join(' ');
  document.getElementById('death-stats').innerHTML = `
    Survived: ${mins}:${secs.toString().padStart(2, '0')}<br>
    Level: ${me.level} · Wave: ${state.wave}<br>
    Kills: ${me.kills}<br>
    <div style="margin-top:8px;font-size:0.7rem;color:#666">Weapons: ${weaponList}</div>
  `;

  // Highlights — MVP weapon, biggest hit, overkill count. Server ships
  // dmgByWeapon / overkills / maxHit / maxHitEnemy on `me` only when
  // dead, so these fields are populated at this point in the flow.
  renderDeathHighlights(document.getElementById('death-highlights'), me);

  // Achievement badges — read-only from localStorage (earned in SP, displayed here)
  const screen = document.getElementById('death-screen');
  let achEl = document.getElementById('mp-ds-achievements');
  if (!achEl) {
    achEl = document.createElement('div');
    achEl.id = 'mp-ds-achievements';
    achEl.style.cssText = 'margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;';
    screen.appendChild(achEl);
  }
  achEl.innerHTML = '';
  const allAch = loadAchievements();
  for (const def of ACHIEVEMENTS) {
    const unlocked = !!allAch[def.id];
    const badge = document.createElement('span');
    badge.className = `ds-ach-badge${unlocked ? '' : ' ds-ach-badge--locked'}`;
    badge.title = `${def.label}: ${def.desc}${unlocked ? '' : ' (locked)'}`;
    badge.textContent = unlocked ? def.icon : '🔒';
    achEl.appendChild(badge);
  }

  screen.style.display = 'flex';
}

function showSpectateOverlay(pid) {
  const player = currState?.players.find(p => p.id === pid);
  const name = player?.name ?? 'player';
  const el = document.getElementById('death-screen');
  if (el) el.style.display = 'none';

  let hud = document.getElementById('spectate-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'spectate-hud';
    Object.assign(hud.style, {
      position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '6px 14px',
      borderRadius: '4px', fontSize: '13px', fontFamily: 'monospace',
      pointerEvents: 'none', zIndex: '60',
    });
    document.body.appendChild(hud);
  }
  hud.textContent = '\u{1F441} SPECTATING ' + name.toUpperCase() + ' \u2014 TAB to cycle';
  hud.style.display = 'block';
}

// ============================================================
// LOBBY UI
// ============================================================

// Per-map preview config: background color + a list of shapes to draw.
// Shape types: 'circle' {x,y,r,fill}, 'rect' {x,y,w,h,fill},
//              'line' {x1,y1,x2,y2,stroke,lw}, 'cross' {x,y,s,fill}
// Coords are 0-1 fractions of the canvas size (W=80, H=52).
const MAP_PREVIEW = {
  arena: {
    bg: '#1a1a1a',
    shapes: [
      // Faint arena boundary ring
      { type: 'circle', x: 0.5, y: 0.5, r: 0.36, fill: null, stroke: '#333', lw: 1.5 },
      { type: 'circle', x: 0.5, y: 0.5, r: 0.08, fill: '#3a3a3a' },
    ],
  },
  forest: {
    bg: '#111a11',
    shapes: [
      { type: 'circle', x: 0.18, y: 0.25, r: 0.09, fill: '#1e4d1e' },
      { type: 'circle', x: 0.32, y: 0.20, r: 0.07, fill: '#245a24' },
      { type: 'circle', x: 0.70, y: 0.30, r: 0.10, fill: '#1e4d1e' },
      { type: 'circle', x: 0.80, y: 0.22, r: 0.07, fill: '#2a6a2a' },
      { type: 'circle', x: 0.15, y: 0.72, r: 0.08, fill: '#245a24' },
      { type: 'circle', x: 0.55, y: 0.78, r: 0.09, fill: '#1e4d1e' },
      { type: 'circle', x: 0.75, y: 0.70, r: 0.08, fill: '#2a6a2a' },
    ],
  },
  ruins: {
    bg: '#1a1710',
    shapes: [
      // Broken courtyard walls (thick rectangles with gaps)
      { type: 'rect', x: 0.22, y: 0.22, w: 0.20, h: 0.06, fill: '#4a4030' },
      { type: 'rect', x: 0.22, y: 0.22, w: 0.05, h: 0.22, fill: '#4a4030' },
      { type: 'rect', x: 0.58, y: 0.22, w: 0.20, h: 0.06, fill: '#4a4030' },
      { type: 'rect', x: 0.73, y: 0.22, w: 0.05, h: 0.22, fill: '#4a4030' },
      { type: 'rect', x: 0.22, y: 0.72, w: 0.20, h: 0.06, fill: '#4a4030' },
      { type: 'rect', x: 0.22, y: 0.56, w: 0.05, h: 0.22, fill: '#4a4030' },
      // Centre pillars
      { type: 'rect', x: 0.44, y: 0.40, w: 0.06, h: 0.06, fill: '#5a5040' },
      { type: 'rect', x: 0.56, y: 0.54, w: 0.06, h: 0.06, fill: '#5a5040' },
    ],
  },
  neon: {
    bg: '#05050f',
    shapes: [
      // Outer ring of pillars (6 of 12 for readability)
      { type: 'circle', x: 0.5,  y: 0.13, r: 0.04, fill: '#00cccc' },
      { type: 'circle', x: 0.82, y: 0.32, r: 0.04, fill: '#00cccc' },
      { type: 'circle', x: 0.82, y: 0.68, r: 0.04, fill: '#00cccc' },
      { type: 'circle', x: 0.5,  y: 0.87, r: 0.04, fill: '#00cccc' },
      { type: 'circle', x: 0.18, y: 0.68, r: 0.04, fill: '#00cccc' },
      { type: 'circle', x: 0.18, y: 0.32, r: 0.04, fill: '#00cccc' },
      // Inner square walls
      { type: 'rect', x: 0.38, y: 0.34, w: 0.24, h: 0.02, fill: '#00aaff' },
      { type: 'rect', x: 0.38, y: 0.64, w: 0.24, h: 0.02, fill: '#00aaff' },
      { type: 'rect', x: 0.36, y: 0.36, w: 0.02, h: 0.28, fill: '#00aaff' },
      { type: 'rect', x: 0.62, y: 0.36, w: 0.02, h: 0.28, fill: '#00aaff' },
    ],
  },
  wilderness: {
    bg: '#101810',
    shapes: [
      // Scattered tree blobs — slightly more spread than forest
      { type: 'circle', x: 0.12, y: 0.30, r: 0.08, fill: '#1e4d1e' },
      { type: 'circle', x: 0.28, y: 0.55, r: 0.09, fill: '#245a24' },
      { type: 'circle', x: 0.50, y: 0.20, r: 0.07, fill: '#1e4d1e' },
      { type: 'circle', x: 0.65, y: 0.60, r: 0.10, fill: '#2a6a2a' },
      { type: 'circle', x: 0.82, y: 0.30, r: 0.08, fill: '#1e4d1e' },
      { type: 'circle', x: 0.40, y: 0.80, r: 0.07, fill: '#245a24' },
    ],
  },
  catacombs: {
    bg: '#111115',
    shapes: [
      // Parallel corridor walls
      { type: 'rect', x: 0.10, y: 0.20, w: 0.80, h: 0.10, fill: '#2e2e3e' },
      { type: 'rect', x: 0.10, y: 0.70, w: 0.80, h: 0.10, fill: '#2e2e3e' },
      // Scattered interior pillars
      { type: 'rect', x: 0.28, y: 0.42, w: 0.07, h: 0.14, fill: '#3a3a4a' },
      { type: 'rect', x: 0.48, y: 0.42, w: 0.07, h: 0.14, fill: '#3a3a4a' },
      { type: 'rect', x: 0.68, y: 0.42, w: 0.07, h: 0.14, fill: '#3a3a4a' },
    ],
  },
  graveyard: {
    bg: '#130f18',
    shapes: [
      // Tombstone rows
      { type: 'cross', x: 0.20, y: 0.28, s: 0.07, fill: '#4a4050' },
      { type: 'cross', x: 0.35, y: 0.28, s: 0.07, fill: '#4a4050' },
      { type: 'cross', x: 0.65, y: 0.28, s: 0.07, fill: '#4a4050' },
      { type: 'cross', x: 0.20, y: 0.55, s: 0.07, fill: '#4a4050' },
      { type: 'cross', x: 0.65, y: 0.55, s: 0.07, fill: '#4a4050' },
      // Mausoleum walls
      { type: 'rect', x: 0.34, y: 0.42, w: 0.32, h: 0.05, fill: '#3a3040' },
      { type: 'rect', x: 0.34, y: 0.56, w: 0.32, h: 0.05, fill: '#3a3040' },
    ],
  },
};

/**
 * Draw a small map preview onto a 80×52 canvas.
 * @param {HTMLCanvasElement} cvs
 * @param {string} mapId
 */
function drawMapPreview(cvs, mapId) {
  const W = cvs.width;
  const H = cvs.height;
  const ctx2 = cvs.getContext('2d');
  const cfg = MAP_PREVIEW[mapId] ?? { bg: '#1a1a1a', shapes: [] };

  ctx2.fillStyle = cfg.bg;
  ctx2.fillRect(0, 0, W, H);

  for (const s of cfg.shapes) {
    ctx2.beginPath();
    if (s.type === 'circle') {
      ctx2.ellipse(s.x * W, s.y * H, s.r * W, s.r * H, 0, 0, Math.PI * 2);
      if (s.fill) { ctx2.fillStyle = s.fill; ctx2.fill(); }
      if (s.stroke) { ctx2.strokeStyle = s.stroke; ctx2.lineWidth = s.lw ?? 1; ctx2.stroke(); }
    } else if (s.type === 'rect') {
      if (s.fill) { ctx2.fillStyle = s.fill; ctx2.fillRect(s.x * W, s.y * H, s.w * W, s.h * H); }
      if (s.stroke) { ctx2.strokeStyle = s.stroke; ctx2.lineWidth = s.lw ?? 1; ctx2.strokeRect(s.x * W, s.y * H, s.w * W, s.h * H); }
    } else if (s.type === 'cross') {
      const cx = s.x * W, cy = s.y * H, half = s.s * Math.min(W, H) / 2, t = half * 0.35;
      ctx2.fillStyle = s.fill;
      // Vertical bar
      ctx2.fillRect(cx - t, cy - half, t * 2, half * 2);
      // Horizontal crossbar (upper third)
      ctx2.fillRect(cx - half, cy - half * 0.5, half * 2, t * 2);
    } else if (s.type === 'line') {
      ctx2.moveTo(s.x1 * W, s.y1 * H);
      ctx2.lineTo(s.x2 * W, s.y2 * H);
      ctx2.strokeStyle = s.stroke;
      ctx2.lineWidth = s.lw ?? 1;
      ctx2.stroke();
    }
  }
}

function renderLobby() {
  const el = document.getElementById('mp-lobby');
  if (!el || !lobbyData) return;
  el.style.display = 'flex';

  const cdEl = document.getElementById('lobby-countdown');
  if (cdEl) cdEl.textContent = `Starting in ${lobbyData.countdown}s`;

  const plEl = document.getElementById('lobby-players');
  const n = lobbyData.playerCount;
  if (plEl) plEl.textContent = `${n} player${n !== 1 ? 's' : ''} connected`;

  const cardsEl = document.getElementById('lobby-map-cards');
  if (!cardsEl) return;
  cardsEl.innerHTML = '';
  for (const mId of lobbyData.mapOptions) {
    const voteCount = lobbyData.votes.filter(v => v.mapId === mId).length;
    const isMyVote = myMapVote === mId;

    const card = document.createElement('div');
    card.className = 'lobby-map-card' + (isMyVote ? ' lobby-map-card--selected' : '');

    const preview = document.createElement('canvas');
    preview.width = 80;
    preview.height = 52;
    preview.className = 'lmc-preview';
    drawMapPreview(preview, mId);
    card.appendChild(preview);

    const nameEl = document.createElement('div');
    nameEl.className = 'lmc-name';
    nameEl.textContent = MAPS[mId]?.name ?? mId;
    card.appendChild(nameEl);

    const votesEl = document.createElement('div');
    votesEl.className = 'lmc-votes';
    votesEl.textContent = `${voteCount} vote${voteCount !== 1 ? 's' : ''}`;
    card.appendChild(votesEl);

    card.addEventListener('click', () => {
      myMapVote = mId;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'mapVote', mapId: mId }));
      }
      renderLobby(); // optimistic highlight
    });
    cardsEl.appendChild(card);
  }
}

// ============================================================
// CLIENT-SIDE PARTICLES (decorative only)
// ============================================================

function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 150;
    safeParticlePush(particles, {
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
  // Swap-delete: O(1) removal vs O(n) splice. Safe in reverse loop —
  // swapped-in element was already visited (higher original index).
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) {
      particles[i] = particles[particles.length - 1];
      particles.pop();
    }
  }
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y += ft.vy * dt;
    ft.life -= dt;
    if (ft.life <= 0) floatingTexts.splice(i, 1);
  }
  if (screenShake > 0) screenShake -= dt;
  if (levelFlash > 0) levelFlash -= dt;
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

  // Auto-advance spectate target when they die
  if (spectateId !== null && currState) {
    const spec = currState.players.find(p => p.id === spectateId);
    if (!spec || !spec.alive) {
      const alive = currState.players.filter(p => p.alive && p.id !== myId);
      if (alive.length > 0) {
        spectateId = alive[0].id;
        showSpectateOverlay(spectateId);
      } else {
        spectateId = null;
        const me = currState.players.find(p => p.id === myId);
        if (me) showDeathScreen(currState, me);
        const hud = document.getElementById('spectate-hud');
        if (hud) hud.style.display = 'none';
      }
    }
  }

  // Update client-side effects
  updateParticles(dt);

  // Tick kill feed — expire entries in place (const array, splice to evict).
  for (let i = killFeed.length - 1; i >= 0; i--) {
    killFeed[i].life -= dt;
    if (killFeed[i].life <= 0) killFeed.splice(i, 1);
  }

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

  // Camera target: follow me if alive, otherwise follow spectated player.
  let camTarget;
  if (me && me.alive) {
    camTarget = { x: me.x, y: me.y };
  } else if (spectateId !== null) {
    const spec = state.players.find(p => p.id === spectateId);
    camTarget = spec ? { x: spec.x, y: spec.y } : { x: arena.w / 2, y: arena.h / 2 };
  } else {
    camTarget = { x: arena.w / 2, y: arena.h / 2 };
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

  // Snap to integer pixels — sub-pixel translation causes shimmer on
  // retina. Math.round causes diagonal jitter because x and y
  // independently flip between rounding up/down on different frames.
  // Floor is monotonic.
  ctx.translate(-Math.floor(cx), -Math.floor(cy));

  // --- background: 3-tier fallback (tileset / neon / grid) ---
  drawBackground(ctx, bgCanvas, mapId, arena, cx, cy, W, H);

  // --- world border ---
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, arena.w, arena.h);

  // --- map obstacles ---
  for (const obs of obstacles) {
    if (obs.x + obs.w < cx || obs.x > cx + W || obs.y + obs.h < cy || obs.y > cy + H) continue;
    drawObstacle(ctx, obs);
  }
  // Per-map ambient VFX (same as SP) — runs under world layer.
  const ambient = getAmbient(state.mapId);
  if (ambient) ambient.tick(particles, { cx, cy, W, H }, performance.now());

  renderWorld(ctx, state, drawSprite, particles,
              { cx, cy, W, H },
              { onSeen: (name) => markSeen(name, state.wave) });
  drawChargeTrail(ctx, state.players);
  drawChainEffects(ctx, state.chainEffects || []);
  drawMeteorEffects(ctx, state.meteorEffects || []);
  drawPendingPulls(ctx, state.pendingPulls);

  // --- players ---
  for (const pl of state.players) {
    if (!pl.alive) continue;

    const isMe = pl.id === myId;
    if (pl.x < cx - 60 || pl.x > cx + W + 60 || pl.y < cy - 60 || pl.y > cy + H + 60) continue;
    const playerRadius = PLAYER_RADIUS;
    const skin = pl.activeSkin;
    const glowColor = skin === 'skin_gold' ? '#f39c12'
                    : skin === 'skin_shadow' ? '#9b59b6'
                    : (isMe ? '#3498db' : pl.color);

    drawPlayerBody(ctx, pl, drawSprite, state.time || 0, {
      skin,
      radius: playerRadius,
      glowColor,
      shadowBlur: skin === 'skin_shadow' ? 25 : (isMe ? 15 : 8),
      fallbackFill: pl.color,
      strokeOnFallback: isMe,
    });

    drawFacingIndicator(ctx, pl, glowColor, playerRadius);

    // Fire trail particles. Spawned local-only so we don't have to add
    // a particle channel to the WS protocol — visible to whoever's
    // watching the wearer. Keyed by player id so each wearer has its
    // own throttle bucket.
    if (pl.activeTrail === 'trail_fire') spawnFireTrail(pl, dt, particles, trailState);

    // "YOU" indicator - arrow above self
    if (isMe) {
      ctx.fillStyle = '#3498db';
      ctx.globalAlpha = 0.7 + Math.sin((state.time || 0) * 4) * 0.3;
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
  drawFloatingTexts(ctx, floatingTexts);

  ctx.restore();

  // Spectator label handled by showSpectateOverlay() DOM element now —
  // persists between frames without redraw, shows Tab hint.

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
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#e74c3c';
    ctx.font = 'bold 36px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#e74c3c';
    ctx.shadowBlur = 20;
    ctx.fillText(`⚠ ${state.specialWaveMsg} ⚠`, W / 2, H * 0.3 + 44);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  // Persistent BOSS INCOMING indicator during the last pre-boss wave.
  // Wave 20 = THE DEMON boss; wave 19 is the final warning.
  if (state.wave === 19) {
    const pulse = 0.7 + Math.sin(performance.now() / 400) * 0.25;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#e74c3c';
    ctx.font = 'bold 28px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#e74c3c';
    ctx.shadowBlur = 16;
    ctx.fillText('⚠ BOSS INCOMING ⚠', W / 2, H * 0.3 + 88);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // --- death feed (bottom-left) ---
  renderDeathFeed(ctx, state.deathFeed || [], state.time, H);

  // fork #19 — level-up flash overlay, parity with SP (src/main.js:980).
  // Paints a yellow full-screen wash that decays 0.15 → 0. Reset transform
  // so the wash fills the viewport regardless of camera state.
  if (levelFlash > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Cap alpha — mirrors src/main.js fix: prevents near-solid yellow
    // "flashbang" when boss-phase + overkill events stack at high waves.
    ctx.globalAlpha = Math.min(0.5, levelFlash / 0.15 * 0.3);
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- HUD ---
  if (state) {
    const mins = Math.floor(state.time / 60);
    const secs = Math.floor(state.time % 60);
    document.getElementById('hud-time').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('hud-players').textContent = `${state.players.length} player${state.players.length !== 1 ? 's' : ''}`;
    document.getElementById('hud-kills').textContent = `${state.kills} kills`;
    document.getElementById('hud-wave').textContent = `Wave ${state.wave} / 20`;
    if (me) {
      document.getElementById('hud-weapons').textContent = (me.weapons || []).map(w => WEAPON_ICONS[w.type] || '?').join(' ');
      document.getElementById('hud-level').textContent = `Lv ${me.level}`;
      const xpFill = document.getElementById('xp-fill');
      if (xpFill) xpFill.style.width = `${Math.min(100, (me.xp / me.xpToLevel) * 100)}%`;
      // Relic HUD
      const relicEl = document.getElementById('hud-relics');
      if (relicEl && me.relics) {
        const relicStr = RELICS
          .filter(r => (me.relics[r.id] || 0) > 0)
          .map(r => me.relics[r.id] > 1 ? `${r.icon}x${me.relics[r.id]}` : r.icon)
          .join(' ');
        if (relicEl.textContent !== relicStr) relicEl.textContent = relicStr;
      }
    }
  }

  drawMinimap();
  drawKillFeed(ctx);
  drawScoreboard(ctx);
}

// ============================================================
// INPUT
// ============================================================

// Keyboard handlers + KEY_MAP live in shared/input.js. Level-up
// callback gates on the per-mode overlay state — MP uses the
// server-driven _levelChoices array (sent via the `levelup`
// message after a level-up event).
installKeyboardInput(keys, {
  onLevelUpKey(idx) {
    if (!window._levelChoices) return false;
    const pick = window._levelChoices[idx];
    if (!pick) return false;
    pick();
    return true;
  },
});

// Keyboard shortcuts for start/death screens
document.addEventListener('keydown', e => {
  // Tab cycles through alive players while spectating.
  if (e.key === 'Tab' && spectateId !== null) {
    e.preventDefault();
    const alive = currState?.players.filter(p => p.alive && p.id !== myId) ?? [];
    if (alive.length > 0) {
      const idx = alive.findIndex(p => p.id === spectateId);
      spectateId = alive[(idx + 1) % alive.length].id;
      showSpectateOverlay(spectateId);
    }
    return;
  }
  const startScreen = document.getElementById('start-screen');
  const deathScreen = document.getElementById('death-screen');
  const startVisible = startScreen.style.display !== 'none' && startScreen.offsetParent !== null;
  const deathVisible = deathScreen.style.display === 'flex';
  if (startVisible) {
    if (weaponPicker.tryKey(e)) return;
    if (e.key === 'Enter' || e.key === ' ') { joinGame(); e.preventDefault(); }
  }
  if (deathVisible) {
    if (weaponPicker.tryKey(e)) return;
    if (e.key === 'Enter' || e.key === ' ') { respawnGame(); e.preventDefault(); }
  }
});

// Click or Tab to switch spectate target
canvas.addEventListener('click', () => {
  if (spectateId !== null && currState) {
    const alive = currState.players.filter(p => p.alive && p.id !== myId);
    if (alive.length > 0) {
      const idx = alive.findIndex(p => p.id === spectateId);
      spectateId = alive[(idx + 1) % alive.length].id;
      showSpectateOverlay(spectateId);
    }
  }
});

// Mobile invisible touch joystick + page-level touch defaults — shared
// with SP via shared/joystick.js. MP omits the analogMove param so
// only boolean keys ride out (server reads keyboard inputs only).
bindTouchJoystick({ canvas, keys });

// Focus name input on load
window.addEventListener('load', () => {
  document.getElementById('name-input').focus();
});

// Expose handlers used by inline HTML.
// Both PLAY and RETRY use `onclick="startGame()"` in template.html — alias
// to joinGame on first press, respawnGame after death.
window.startGame = () => (renderStarted && iDied ? respawnGame() : joinGame());
window.selectWeapon = weaponPicker.select;
// toggleMute, setBgmVol, setSfxVol — wired by bootSharedServices() (step 3b).
// toggleVolPanel, showBestiary, hideBestiary — also wired by bootSharedServices().

