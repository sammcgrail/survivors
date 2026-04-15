#!/usr/bin/env node
// Survivors multiplayer server — thin shell over shared/sim/.
//
// The game loop is `tickSim(g, dt)` from src/shared/sim/tick.js — the
// exact same code that drives the SP client. SP wraps a single player in
// `g.players = [g.player]`; this server uses `g.players = [...players]`.
// One source of truth for game logic, weapons, AI, balance.
//
// This file owns: WebSocket plumbing, per-player makePlayer factory,
// state→client snapshot serialization, connection lifecycle.
//
// Listens on port 7700 by default (override with SURVIVORS_PORT).
import { WebSocketServer } from 'ws';
import { tickSim } from './src/shared/sim/tick.js';
import { createRng } from './src/shared/sim/rng.js';
import { createWeapon } from './src/shared/weapons.js';
import { POWERUPS, getAvailableChoices } from './src/shared/sim/powerups.js';
import { MAPS } from './src/shared/maps.js';
import { pushOutOfObstacles } from './src/shared/sim/collision.js';
import { applyUnlocks, sanitizePrestige } from './src/shared/prestige.js';

// Map rotation. Tomorrow this'll be a vote / lobby choice; for now the
// server picks a random one each session reset.
const MAP_ROTATION = ['arena', 'forest', 'ruins', 'graveyard'];
function pickMapId(rng) {
  return MAP_ROTATION[rng.int(MAP_ROTATION.length)];
}
import {
  WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP,
  XP_MAGNET_RANGE,
} from './src/shared/constants.js';

const PORT = Number(process.env.SURVIVORS_PORT) || 7700;
const TICK_RATE = 20;
const TICK_DT = 1 / TICK_RATE;
const MAX_PLAYERS = 8;

const COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f1c40f',
  '#9b59b6', '#e67e22', '#1abc9c', '#e84393',
];

// Starting weapons selectable from the join screen. dragon_storm is an
// evolution (spit + breath fused) and isn't a starting choice.
const STARTING_WEAPONS = new Set([
  'spit', 'breath', 'charge', 'orbit', 'chain', 'meteor', 'shield', 'lightning_field',
]);

const players = new Map(); // ws -> player object
let game = null;
let nextId = 0;

function makePlayer(pid, name, weaponType, rng, spawn, prestige) {
  const p = {
    id: pid,
    name: (name || `player${pid}`).slice(0, 12),
    color: COLORS[pid % COLORS.length],
    x: spawn.x + (rng.random() - 0.5) * Math.min(400, spawn.radius),
    y: spawn.y + (rng.random() - 0.5) * Math.min(400, spawn.radius),
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
    kills: 0,
    score: 0,
    weapons: [createWeapon(weaponType)],
    alive: true,
    iframes: 2.0, // spawn protection
    facing: { x: 1, y: 0 },
    inputs: { up: false, down: false, left: false, right: false },
    // Per-player powerup catalog stacks. Starting weapon = stack 1 so
    // its `_up` upgrades unlock immediately. pendingChoice holds an
    // outstanding level-up the player hasn't responded to yet.
    powerupStacks: { ['weapon_' + weaponType]: 1 },
    pendingChoice: null,
    // Cosmetics broadcast in state so peers can render skins/trail.
    activeSkin: prestige ? prestige.activeSkin : null,
    activeTrail: prestige ? prestige.activeTrail : null,
  };
  if (prestige) applyUnlocks(p, prestige.unlocks);
  // Headstart prestige bumps level; scale xp threshold to match.
  for (let i = 1; i < p.level; i++) p.xpToLevel = Math.floor(p.xpToLevel * 1.30);
  return p;
}

function initGame() {
  const rng = createRng(Date.now() & 0x7fffffff);
  const mapId = pickMapId(rng);
  const map = MAPS[mapId];
  console.log(`[*] map: ${mapId} (${map.name})`);
  return {
    players: [], // populated each tick from `players` Map
    enemies: [],
    projectiles: [],
    gems: [],
    heartDrops: [],
    consumables: [],
    chainEffects: [],
    meteorEffects: [],
    chargeTrails: [],
    deathFeed: [],
    time: 0,
    wave: 1,
    waveTimer: 0,
    waveDuration: 20,
    spawnTimer: 0,
    spawnRate: 2.0,
    specialWaveMsg: null,
    specialWaveMsgTimer: 0,
    waveMsg: '',
    waveMsgTimer: 0,
    kills: 0,
    playerName: 'mp', // unused in MP but referenced by waves.js deathFeed
    events: [],
    rng,
    mapId,
    arena: { w: map.width, h: map.height },
    obstacles: map.obstacles,
  };
}

// Apply per-player input each tick before tickSim runs. The shared sim
// reads p.facing + moves the player itself on charge weapons; for plain
// movement we apply inputs here since there's no shared input pipe.
function applyInputs(g, dt) {
  for (const p of g.players) {
    if (!p.alive) continue;
    const inp = p.inputs;
    let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
    if (dx || dy) p.facing = { x: dx, y: dy };
    const slow = p._terrainSlow || 1;
    p.x = Math.max(p.radius, Math.min(g.arena.w - p.radius, p.x + dx * p.speed * slow * dt));
    p.y = Math.max(p.radius, Math.min(g.arena.h - p.radius, p.y + dy * p.speed * slow * dt));
    if (g.obstacles.length > 0) pushOutOfObstacles(p, g.obstacles);
    if (p.hpRegen > 0) p.hp = Math.min(p.maxHp, p.hp + p.hpRegen * dt);
    if (p.iframes > 0) p.iframes -= dt;
  }
}

function tick(dt) {
  if (!game) return;
  // Snapshot includes dead players too — sim checks p.alive itself, and
  // keeping them in the array means their `id` stays attributable for
  // kill credit. Broadcast still ships them so spectators see the body.
  game.players = [...players.values()];
  if (!game.players.some(p => p.alive)) {
    game.events.length = 0;
    return;
  }
  game.time += dt;
  game.waveTimer += dt;
  applyInputs(game, dt);
  tickSim(game, dt);
  // Forward LEVEL_UP events to the leveling player as a `levelup`
  // message with three random valid choices. Other events ride the
  // state snapshot as of the event-channel work (Tier C) — clients
  // drain them into local particles / floating text / sfx.
  for (const evt of game.events) {
    if (evt.type === 'levelUp') sendLevelUp(evt.pid);
    else if (evt.type === 'waveSurvived') {
      // SP localizes this with the player's name; in MP there's no
      // single player so use a generic line that broadcasts to all.
      game.deathFeed.push({ text: `Wave ${evt.wave} cleared`, time: evt.time });
    }
  }
  // events cleared after broadcast in startLoop so the snapshot can
  // ride them out to clients.
}

function sendLevelUp(pid) {
  const player = game.players.find(p => p.id === pid);
  if (!player) return;
  const available = getAvailableChoices(player.powerupStacks);
  for (let i = available.length - 1; i > 0; i--) {
    const j = game.rng.int(i + 1);
    [available[i], available[j]] = [available[j], available[i]];
  }
  const choices = available.slice(0, 3);
  if (choices.length === 0) return; // every powerup maxed; skip
  player.pendingChoice = choices.map(c => c.id);
  const entry = [...players].find(([, p]) => p.id === pid);
  if (!entry) return;
  try {
    entry[0].send(JSON.stringify({
      type: 'levelup',
      choices: choices.map(c => ({ id: c.id, name: c.name, desc: c.desc, icon: c.icon })),
    }));
  } catch { /* dead socket — close handler cleans up */ }
}

function r1(n) { return Math.round(n * 10) / 10; }
function r2(n) { return Math.round(n * 100) / 100; }

// Per-weapon visual fields the shared renderer needs. Ships raw base
// values — sizeMulti + projectileBonus ride on the player snapshot
// and the renderer applies them once, so SP (reading live `w.radius`)
// and MP (reading the snapshot) stay in sync under Amplify/Volley.
//
// Live state shipped (phase, pulsePhase, fireCount, active flags) is
// what drives the shared weapon-aura render — MP can't fake
// `gameTime * k` once SP and MP share the same code path because the
// SP version reads w.phase directly. 2-decimal precision keeps the
// snapshot tight.
function snapshotWeapon(w) {
  const o = { type: w.type };
  if (w.color !== undefined)        o.color = w.color;
  if (w.radius !== undefined)       o.radius = w.radius;
  if (w.fieldRadius !== undefined)  o.fieldRadius = w.fieldRadius;
  if (w.shieldRadius !== undefined) o.shieldRadius = w.shieldRadius;
  if (w.auraRadius !== undefined)   o.auraRadius = w.auraRadius;
  if (w.bladeCount !== undefined)   o.bladeCount = w.bladeCount;
  if (w.phase !== undefined)        o.phase = r2(w.phase);
  if (w.pulsePhase !== undefined)   o.pulsePhase = r2(w.pulsePhase);
  if (w.fireCount !== undefined)    o.fireCount = w.fireCount;
  if (w.active)                     o.active = true;
  if (w.chargeDx !== undefined && w.active) {
    o.chargeDx = r2(w.chargeDx);
    o.chargeDy = r2(w.chargeDy);
  }
  // Charge weapon dash trail — only meaningful while active. Ships
  // enough fields for drawChargeTrail to reconstruct the tapered
  // streak + speed lines + slash arc (speed/duration static per run,
  // chargeTimer is the animated one).
  if (w.type === 'charge' && w.active) {
    o.speed = w.speed;
    o.duration = w.duration;
    o.chargeTimer = r2(w.chargeTimer);
    o.width = w.width;
  }
  // Cooldown indicator — drawn around the player on charge/fortress
  // while the weapon recharges. Without these the MP player has no
  // visual cue when their next dash is ready (SP reads w.timer +
  // w.cooldown directly from the live sim).
  if ((w.type === 'charge' || w.type === 'fortress') && !w.active) {
    if (w.timer !== undefined)    o.timer = r2(w.timer);
    if (w.cooldown !== undefined) o.cooldown = w.cooldown;
  }
  return o;
}

// Build the world snapshot once per tick. `you` is per-recipient and
// stamped at send time so we don't re-stringify the whole state N times.
function gameSnapshot() {
  return {
    type: 'state',
    t: Date.now() / 1000,
    wave: game.wave,
    time: r1(game.time),
    kills: game.kills,
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color,
      x: r2(p.x), y: r2(p.y),
      hp: r1(p.hp), maxHp: p.maxHp,
      alive: p.alive, level: p.level, kills: p.kills,
      xp: p.xp, xpToLevel: p.xpToLevel,
      // Size/bonus multipliers ride on the player so shared render
      // applies them once. Only ship when non-default to save bytes.
      ...(p.sizeMulti && p.sizeMulti !== 1 ? { sizeMulti: r2(p.sizeMulti) } : {}),
      ...(p.projectileBonus ? { projectileBonus: p.projectileBonus } : {}),
      // Facing + iframes drive shared visuals: direction triangle +
      // damage-flicker alpha. Both ship only when meaningful to save
      // bytes on the resting-state path.
      ...(p.facing && (p.facing.x || p.facing.y)
        ? { facing: { x: r2(p.facing.x), y: r2(p.facing.y) } } : {}),
      ...(p.iframes > 0 ? { iframes: r2(p.iframes) } : {}),
      weapons: p.weapons.map(snapshotWeapon),
      activeSkin: p.activeSkin,
      activeTrail: p.activeTrail,
    })),
    enemies: game.enemies.map(e => ({
      name: e.name,
      x: r1(e.x), y: r1(e.y),
      hp: e.hp, maxHp: e.maxHp,
      radius: e.radius, color: e.color,
      // hitFlash + dying ride only when meaningful — the common
      // case (no flash, alive) saves bytes per enemy per tick.
      // Renderer reads both as `|| 0` / `=== undefined` so missing
      // is fine.
      ...(e.hitFlash > 0 ? { hitFlash: r2(e.hitFlash) } : {}),
      ...(e.dying !== undefined ? { dying: r2(e.dying) } : {}),
    })),
    // Renderer doesn't read xp on the gem snapshot — xp ships on
    // the GEM_PICKUP event when picked up. drawGem falls back on a
    // default radius too, so position is enough.
    gems: game.gems.map(gem => ({ x: r1(gem.x), y: r1(gem.y) })),
    projectiles: game.projectiles.map(pr => ({
      x: r1(pr.x), y: r1(pr.y), radius: pr.radius, owner: pr.owner,
      // Color + velocity ride along so the shared projectile render
      // can draw trail sprites and per-bullet glow without an
      // owner-id lookup at draw time.
      color: pr.color,
      vx: r1(pr.vx), vy: r1(pr.vy),
    })),
    chainEffects: game.chainEffects.map(c => ({
      points: c.points.map(pt => ({ x: r1(pt.x), y: r1(pt.y) })),
      life: r2(c.life), color: c.color,
    })),
    meteorEffects: game.meteorEffects.map(m => ({
      x: r1(m.x), y: r1(m.y), radius: m.radius,
      life: r2(m.life), phase: m.phase, color: m.color,
    })),
    // Renderer doesn't read heal on the heart snapshot — `+N HP`
    // text comes through HEART_PICKUP event when grabbed.
    heartDrops: game.heartDrops.map(h => ({
      x: r1(h.x), y: r1(h.y), radius: h.radius,
      life: r2(h.life), bobPhase: r2(h.bobPhase),
    })),
    // Consumables never despawn now (life: Infinity) so dropping
    // life saves bytes per drop per tick. Late-fade branch in
    // drawConsumables is dead code under the new lifetime policy.
    consumables: game.consumables.map(c => ({
      x: r1(c.x), y: r1(c.y), type: c.type, radius: c.radius,
      color: c.color, bobPhase: r2(c.bobPhase),
    })),
    chargeTrails: (game.chargeTrails || []).map(t => ({
      x: r1(t.x), y: r1(t.y), radius: t.radius,
      life: r2(t.life), color: t.color,
    })),
    deathFeed: game.deathFeed.slice(-5).map(d => ({ text: d.text, time: r1(d.time) })),
    // Transient sim events from this tick — damage numbers, kill
    // particles, sfx triggers, screen-shake cues. Clients drain and
    // apply locally. Coordinates rounded to save bytes; levelUp kept
    // too so peers can hear the levelup sfx on each other.
    events: game.events.map(e => {
      const o = { type: e.type };
      if (e.x !== undefined) o.x = r1(e.x);
      if (e.y !== undefined) o.y = r1(e.y);
      if (e.dmg !== undefined) o.dmg = Math.round(e.dmg);
      if (e.radius !== undefined) o.radius = Math.round(e.radius);
      if (e.color !== undefined) o.color = e.color;
      if (e.name !== undefined) o.name = e.name;
      if (e.weapon !== undefined) o.weapon = e.weapon;
      if (e.pid !== undefined) o.pid = e.pid;
      if (e.killer !== undefined) o.killer = e.killer;
      if (e.vx !== undefined) o.vx = r1(e.vx);
      if (e.vy !== undefined) o.vy = r1(e.vy);
      if (e.by !== undefined) o.by = e.by;
      if (e.xp !== undefined) o.xp = e.xp;
      if (e.healed !== undefined) o.healed = r1(e.healed);
      if (e.level !== undefined) o.level = e.level;
      if (e.wave !== undefined) o.wave = e.wave;
      if (e.label !== undefined) o.label = e.label;
      if (e.ctype !== undefined) o.ctype = e.ctype;
      return o;
    }),
    waveMsg:        game.waveMsgTimer        > 0 ? game.waveMsg        : null,
    waveMsgTimer:   r2(game.waveMsgTimer),
    specialWaveMsg: game.specialWaveMsgTimer > 0 ? game.specialWaveMsg : null,
    specialWaveMsgTimer: r2(game.specialWaveMsgTimer),
    arena: game.arena,
    mapId: game.mapId,
  };
}

function broadcast() {
  if (players.size === 0) return;
  const base = gameSnapshot();
  for (const [ws, p] of players) {
    base.you = p.id;
    try { ws.send(JSON.stringify(base)); } catch { /* dead socket — close handler cleans up */ }
  }
}

function startLoop() {
  game = initGame();
  setInterval(() => {
    tick(TICK_DT);
    broadcast();
    // Clear events after every client sees the snapshot once — each
    // event fires exactly once per client instead of leaking into
    // the next tick or being sent twice.
    game.events.length = 0;
  }, TICK_DT * 1000);
}

// 4 KB cap on inbound frames — protocol messages are tiny (< 200 B).
// Anything larger is hostile or buggy; ws closes the socket with code 1009.
const wss = new WebSocketServer({ port: PORT, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws) => {
  const pid = nextId++;
  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      if (player) return; // double-join on same socket: first wins
      if (players.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: 'error', reason: 'server_full' }));
        ws.close();
        return;
      }
      // Reset game state when first player joins an empty server so they
      // don't spawn into a wave-18 death trap left over from prior sessions.
      const anyAlive = [...players.values()].some(p => p.alive);
      if (!anyAlive) {
        game = initGame();
        console.log('[*] game reset (no alive players)');
      }
      const name = String(msg.name || '').slice(0, 12).trim() || `player${pid}`;
      const weapon = STARTING_WEAPONS.has(msg.weapon) ? msg.weapon : 'spit';
      const prestige = sanitizePrestige(msg.prestige);
      player = makePlayer(pid, name, weapon, game.rng, MAPS[game.mapId].spawns[0], prestige);
      players.set(ws, player);
      console.log(`[+] ${name} joined with ${weapon} (${players.size} players)`);
      ws.send(JSON.stringify({
        type: 'welcome',
        you: pid,
        name: player.name,
        color: player.color,
        arena: game.arena,
        map: { id: game.mapId, obstacles: game.obstacles },
      }));
      // Headstart prestige: queue level-up choice for the bonus level so
      // the player picks a perk on join. Processed next tick when
      // game.players is rebuilt from the players Map.
      for (let i = 1; i < player.level; i++) {
        game.events.push({ type: 'levelUp', level: i + 1, pid });
      }
      return;
    }
    if (!player) return;

    if (msg.type === 'input') {
      const k = msg.keys || {};
      player.inputs.up = !!k.up;
      player.inputs.down = !!k.down;
      player.inputs.left = !!k.left;
      player.inputs.right = !!k.right;
    } else if (msg.type === 'name') {
      const newName = String(msg.name || '').slice(0, 12).trim();
      if (newName) player.name = newName;
    } else if (msg.type === 'respawn') {
      // Only let dead players respawn — without this a live player could
      // spam respawn to reset iframes + heal to full + reroll weapon.
      if (player.alive) return;
      const weapon = STARTING_WEAPONS.has(msg.weapon) ? msg.weapon : 'spit';
      const prestige = sanitizePrestige(msg.prestige);
      Object.assign(player, makePlayer(pid, player.name, weapon, game.rng, MAPS[game.mapId].spawns[0], prestige));
      // Headstart: queue level-up choices on respawn too.
      for (let i = 1; i < player.level; i++) {
        game.events.push({ type: 'levelUp', level: i + 1, pid });
      }
    } else if (msg.type === 'choose') {
      // Reply to a pending levelup. choiceId must be one of the three the
      // server offered; otherwise drop silently (catch fat-finger races).
      if (!player.pendingChoice || !player.pendingChoice.includes(msg.choiceId)) return;
      const choice = POWERUPS.find(p => p.id === msg.choiceId);
      if (!choice) return;
      player.powerupStacks[choice.id] = (player.powerupStacks[choice.id] || 0) + 1;
      choice.apply(game, player);
      player.pendingChoice = null;
    }
  });

  ws.on('close', () => {
    if (players.has(ws)) {
      console.log(`[-] ${player ? player.name : '?'} left (${players.size - 1} players)`);
      players.delete(ws);
    }
  });
});

console.log(`survivors v1b node server on :${PORT}`);
console.log(`world: ${WORLD_W}x${WORLD_H}, tick: ${TICK_RATE}Hz, max players: ${MAX_PLAYERS}`);
startLoop();
