#!/usr/bin/env node
// Survivors v1b multiplayer server — thin shell over shared/sim/.
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

function makePlayer(pid, name, weaponType, rng) {
  return {
    id: pid,
    name: (name || `player${pid}`).slice(0, 12),
    color: COLORS[pid % COLORS.length],
    x: WORLD_W / 2 + (rng.random() - 0.5) * 400,
    y: WORLD_H / 2 + (rng.random() - 0.5) * 400,
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
  };
}

function initGame() {
  return {
    players: [], // populated each tick from `players` Map
    enemies: [],
    projectiles: [],
    gems: [],
    heartDrops: [],
    chainEffects: [],
    meteorEffects: [],
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
    rng: createRng(Date.now() & 0x7fffffff),
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
    p.x = Math.max(p.radius, Math.min(WORLD_W - p.radius, p.x + dx * p.speed * dt));
    p.y = Math.max(p.radius, Math.min(WORLD_H - p.radius, p.y + dy * p.speed * dt));
    if (p.hpRegen > 0) p.hp = Math.min(p.maxHp, p.hp + p.hpRegen * dt);
    if (p.iframes > 0) p.iframes -= dt;
  }
}

function tick(dt) {
  if (!game) return;
  // Snapshot the active players into g.players for the sim. Includes
  // dead players too (sim checks p.alive); they vanish from the broadcast
  // in gameStateFor since we filter the snapshot, but keeping them in
  // g.players means their `id` stays attributable for kill credit.
  game.players = [...players.values()];
  if (game.players.filter(p => p.alive).length === 0) {
    // Drain the event queue so it doesn't grow unboundedly while idle.
    game.events.length = 0;
    return;
  }
  game.time += dt;
  game.waveTimer += dt;
  applyInputs(game, dt);
  tickSim(game, dt);
  // Sim-emitted events aren't consumed by anyone server-side; drop them
  // each tick rather than letting the queue grow.
  game.events.length = 0;
}

function r1(n) { return Math.round(n * 10) / 10; }
function r2(n) { return Math.round(n * 100) / 100; }

function gameStateFor(viewerId) {
  const ps = game.players.map(p => ({
    id: p.id, name: p.name, color: p.color,
    x: r1(p.x), y: r1(p.y),
    hp: r1(p.hp), maxHp: p.maxHp,
    alive: p.alive, level: p.level, kills: p.kills,
    weapons: p.weapons.map(w => w.type),
  }));
  const enemies = game.enemies.map(e => ({
    name: e.name,
    x: r1(e.x), y: r1(e.y),
    hp: e.hp, maxHp: e.maxHp,
    radius: e.radius, color: e.color,
    hitFlash: r2(e.hitFlash || 0),
  }));
  const gems = game.gems.map(gem => ({ x: r1(gem.x), y: r1(gem.y), xp: gem.xp }));
  const projectiles = game.projectiles.map(pr => ({
    x: r1(pr.x), y: r1(pr.y), radius: pr.radius, owner: pr.owner,
  }));
  const chainEffects = game.chainEffects.map(c => ({
    points: c.points.map(pt => ({ x: r1(pt.x), y: r1(pt.y) })),
    life: r2(c.life), color: c.color,
  }));
  const meteorEffects = game.meteorEffects.map(m => ({
    x: r1(m.x), y: r1(m.y), radius: m.radius,
    life: r2(m.life), phase: m.phase, color: m.color,
  }));
  return {
    type: 'state',
    t: Date.now() / 1000,
    wave: game.wave,
    time: r1(game.time),
    kills: game.kills,
    players: ps,
    enemies, gems, projectiles, chainEffects, meteorEffects,
    you: viewerId,
    arena: { w: WORLD_W, h: WORLD_H },
  };
}

function broadcast() {
  for (const [ws, p] of players) {
    try { ws.send(JSON.stringify(gameStateFor(p.id))); } catch { /* dead socket — close handler cleans up */ }
  }
}

function startLoop() {
  game = initGame();
  setInterval(() => {
    tick(TICK_DT);
    broadcast();
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
      const aliveCount = [...players.values()].filter(p => p.alive).length;
      if (aliveCount === 0) {
        game = initGame();
        console.log('[*] game reset (no alive players)');
      }
      const name = String(msg.name || '').slice(0, 12).trim() || `player${pid}`;
      const weapon = STARTING_WEAPONS.has(msg.weapon) ? msg.weapon : 'spit';
      player = makePlayer(pid, name, weapon, game.rng);
      players.set(ws, player);
      console.log(`[+] ${name} joined with ${weapon} (${players.size} players)`);
      ws.send(JSON.stringify({
        type: 'welcome',
        you: pid,
        name: player.name,
        color: player.color,
        arena: { w: WORLD_W, h: WORLD_H },
      }));
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
      const weapon = STARTING_WEAPONS.has(msg.weapon) ? msg.weapon : 'spit';
      Object.assign(player, makePlayer(pid, player.name, weapon, game.rng));
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
