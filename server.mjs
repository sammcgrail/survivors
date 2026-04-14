#!/usr/bin/env node
// Survivors v1b multiplayer server.
//
// Reuses the canonical game data from src/shared/ so SP and MP read from
// one place: enemy stats, wave pools, special waves, weapon defs, world
// dims. Game loop is its own implementation for now since the tick.js
// orchestrator is single-player oriented (one g.player). Future work
// will unify with shared/sim/.
//
// Listens on port 7700 by default (override with SURVIVORS_PORT).
// WebSocket path is /ws to match the existing v1b client.
import { WebSocketServer } from 'ws';
import {
  ENEMY_TYPES, WAVE_POOLS, SPECIAL_WAVES, enemyType,
} from './src/shared/enemyTypes.js';
import { createWeapon } from './src/shared/weapons.js';
import {
  WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP,
  XP_RADIUS, XP_MAGNET_RANGE, XP_MAGNET_SPEED,
} from './src/shared/constants.js';

const PORT = Number(process.env.SURVIVORS_PORT) || 7700;
const TICK_RATE = 20;
const TICK_DT = 1 / TICK_RATE;
const MAX_PLAYERS = 8;

const COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f1c40f',
  '#9b59b6', '#e67e22', '#1abc9c', '#e84393',
];

const players = new Map(); // ws -> player
let game = null;
let nextId = 0;

function rand(min, max) { return min + Math.random() * (max - min); }

function makePlayer(pid, name, weaponType) {
  return {
    id: pid,
    name: (name || `player${pid}`).slice(0, 12),
    color: COLORS[pid % COLORS.length],
    x: WORLD_W / 2 + rand(-200, 200),
    y: WORLD_H / 2 + rand(-200, 200),
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
    weapons: [createWeapon(weaponType)],
    alive: true,
    iframes: 2.0, // spawn protection
    facing: { x: 1, y: 0 },
    inputs: { up: false, down: false, left: false, right: false },
    kills: 0,
    score: 0,
  };
}

function initGame() {
  return {
    enemies: [],
    projectiles: [],
    gems: [],
    time: 0,
    wave: 1,
    waveTimer: 0,
    waveDuration: 20,
    spawnTimer: 0,
    spawnRate: 2.0,
    kills: 0,
  };
}

function spawnEnemy(g) {
  const alive = [...players.values()].filter(p => p.alive);
  if (alive.length === 0) return;
  const target = alive[Math.floor(Math.random() * alive.length)];
  const angle = Math.random() * Math.PI * 2;
  const dist = 500 + Math.random() * 200;
  const e = enemyType(g.wave);
  // Scale HP up with player count: +30% per extra player.
  const pcMulti = 1 + (alive.length - 1) * 0.3;
  e.hp = Math.floor(e.hp * pcMulti);
  e.maxHp = e.hp;
  e.x = Math.max(e.radius, Math.min(WORLD_W - e.radius, target.x + Math.cos(angle) * dist));
  e.y = Math.max(e.radius, Math.min(WORLD_H - e.radius, target.y + Math.sin(angle) * dist));
  g.enemies.push(e);
}

function spawnGem(g, x, y, xp) {
  g.gems.push({ x, y, xp, radius: XP_RADIUS });
}

function damageEnemy(g, e, dmg, killerId) {
  e.hp -= dmg;
  e.hitFlash = 1;
  if (e.hp <= 0) {
    spawnGem(g, e.x, e.y, e.xp);
    const idx = g.enemies.indexOf(e);
    if (idx >= 0) g.enemies.splice(idx, 1);
    g.kills++;
    if (killerId !== undefined) {
      for (const p of players.values()) {
        if (p.id === killerId) { p.kills++; break; }
      }
    }
    return true;
  }
  return false;
}

function fireSpit(g, p, w) {
  let nearest = null, nearestDist = w.range;
  for (const e of g.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < nearestDist) { nearest = e; nearestDist = d; }
  }
  if (!nearest) return;
  const dx = nearest.x - p.x, dy = nearest.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return;
  const nx = dx / d, ny = dy / d;
  const count = w.count || 1;
  for (let i = 0; i < count; i++) {
    const spread = count > 1 ? (i - (count - 1) / 2) * 0.15 : 0;
    const cs = Math.cos(spread), sn = Math.sin(spread);
    const fx = nx * cs - ny * sn;
    const fy = nx * sn + ny * cs;
    g.projectiles.push({
      x: p.x + fx * 20, y: p.y + fy * 20,
      vx: fx * w.speed, vy: fy * w.speed,
      speed: w.speed, damage: w.damage, range: w.range,
      dist: 0, pierce: w.pierce || 1, radius: 5, owner: p.id,
    });
  }
}

function fireCharge(g, p, w) {
  const fx = p.facing.x, fy = p.facing.y;
  const d = Math.hypot(fx, fy);
  if (d > 0) { w.chargeDx = fx / d; w.chargeDy = fy / d; }
  else { w.chargeDx = 1; w.chargeDy = 0; }
  w.active = true;
  w.chargeTimer = w.duration;
}

function fireWeapon(g, p, w) {
  if (w.type === 'spit') fireSpit(g, p, w);
  else if (w.type === 'charge') fireCharge(g, p, w);
}

function tickPlayer(g, p, dt) {
  const inp = p.inputs;
  let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  if (dx || dy) p.facing = { x: dx, y: dy };
  p.x = Math.max(p.radius, Math.min(WORLD_W - p.radius, p.x + dx * p.speed * dt));
  p.y = Math.max(p.radius, Math.min(WORLD_H - p.radius, p.y + dy * p.speed * dt));

  if (p.hpRegen > 0) p.hp = Math.min(p.maxHp, p.hp + p.hpRegen * dt);
  if (p.iframes > 0) p.iframes -= dt;

  for (const w of p.weapons) {
    w.timer -= dt * p.attackSpeedMulti;
    if (w.timer <= 0 && w.type !== 'breath' && w.type !== 'orbit') {
      w.timer = w.cooldown;
      fireWeapon(g, p, w);
    }
    if (w.type === 'charge' && w.active) {
      w.chargeTimer -= dt;
      if (w.chargeTimer <= 0) w.active = false;
    }
    if (w.type === 'orbit') {
      w.phase = (w.phase || 0) + (w.rotSpeed || 3) * dt;
      const blades = w.bladeCount || 2;
      for (let b = 0; b < blades; b++) {
        const angle = w.phase + (b * Math.PI * 2 / blades);
        const bx = p.x + Math.cos(angle) * (w.radius || 70);
        const by = p.y + Math.sin(angle) * (w.radius || 70);
        for (const e of [...g.enemies]) {
          const ddx = bx - e.x, ddy = by - e.y;
          if (ddx * ddx + ddy * ddy < (10 + e.radius) ** 2) {
            damageEnemy(g, e, (w.damage || 12) * p.damageMulti * dt * 8, p.id);
          }
        }
      }
    }
    if (w.type === 'breath') {
      for (const e of [...g.enemies]) {
        const edx = p.x - e.x, edy = p.y - e.y;
        if (Math.hypot(edx, edy) < (w.radius || 80) + e.radius) {
          damageEnemy(g, e, w.damage * p.damageMulti * dt, p.id);
        }
      }
    }
    if (w.type === 'charge' && w.active) {
      const cdx = w.chargeDx, cdy = w.chargeDy;
      for (const e of [...g.enemies]) {
        const ex = e.x - p.x, ey = e.y - p.y;
        const fwd = ex * cdx + ey * cdy;
        const lat = Math.abs(ex * (-cdy) + ey * cdx);
        if (fwd > -w.width && fwd < w.speed * w.duration && lat < w.width + e.radius) {
          damageEnemy(g, e, w.damage * p.damageMulti * dt * 3, p.id);
        }
      }
    }
  }
}

function tickProjectiles(g, dt) {
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const proj = g.projectiles[i];
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    proj.dist += proj.speed * dt;
    if (proj.dist > proj.range) { g.projectiles.splice(i, 1); continue; }
    for (let j = g.enemies.length - 1; j >= 0; j--) {
      const e = g.enemies[j];
      const edx = proj.x - e.x, edy = proj.y - e.y;
      if (edx * edx + edy * edy < (proj.radius + e.radius) ** 2) {
        const owner = [...players.values()].find(p => p.id === proj.owner);
        const dmgMulti = owner ? owner.damageMulti : 1;
        damageEnemy(g, e, proj.damage * dmgMulti, proj.owner);
        proj.pierce--;
        if (proj.pierce <= 0) { g.projectiles.splice(i, 1); break; }
      }
    }
  }
}

function tickEnemies(g, dt) {
  for (const e of [...g.enemies]) {
    if (e.hitFlash > 0) e.hitFlash -= dt * 5;

    let nearest = null, nearestDist = Infinity;
    for (const p of players.values()) {
      if (!p.alive) continue;
      const ddx = p.x - e.x, ddy = p.y - e.y;
      const d = Math.hypot(ddx, ddy);
      if (d < nearestDist) { nearest = p; nearestDist = d; }
    }
    if (!nearest) continue;

    const ddx = nearest.x - e.x, ddy = nearest.y - e.y;
    const dist = Math.hypot(ddx, ddy);
    if (dist > 1) {
      if (e.name === 'ghost') {
        const nx = ddx / dist, ny = ddy / dist;
        const sign = e.orbitSign || 1;
        const perpX = -ny * sign, perpY = nx * sign;
        const inward = dist > 100 ? 0.8 : 1.0;
        const orbit = dist > 100 ? 0.6 : (dist > 30 ? 0.3 : 0.1);
        e.x += (nx * inward + perpX * orbit) * e.speed * dt;
        e.y += (ny * inward + perpY * orbit) * e.speed * dt;
      } else {
        e.x += (ddx / dist) * e.speed * dt;
        e.y += (ddy / dist) * e.speed * dt;
      }
    }
    e.x = Math.max(e.radius, Math.min(WORLD_W - e.radius, e.x));
    e.y = Math.max(e.radius, Math.min(WORLD_H - e.radius, e.y));

    for (const p of players.values()) {
      if (!p.alive || p.iframes > 0) continue;
      const pdx = p.x - e.x, pdy = p.y - e.y;
      if (Math.hypot(pdx, pdy) < p.radius + e.radius) {
        p.hp -= e.damage;
        p.iframes = 0.5;
        if (p.hp <= 0) { p.hp = 0; p.alive = false; }
      }
    }
  }
}

function tickGems(g, dt) {
  for (let i = g.gems.length - 1; i >= 0; i--) {
    const gem = g.gems[i];
    let pickedUp = false;
    for (const p of players.values()) {
      if (!p.alive) continue;
      const gdx = p.x - gem.x, gdy = p.y - gem.y;
      const dist = Math.hypot(gdx, gdy);
      if (dist < p.magnetRange && dist > 0) {
        const pull = XP_MAGNET_SPEED * dt;
        gem.x += (gdx / dist) * Math.min(pull, dist);
        gem.y += (gdy / dist) * Math.min(pull, dist);
      }
      if (dist < p.radius + gem.radius) {
        p.xp += gem.xp;
        p.score += gem.xp;
        g.gems.splice(i, 1);
        while (p.xp >= p.xpToLevel) {
          p.xp -= p.xpToLevel;
          p.level++;
          p.xpToLevel = Math.floor(p.xpToLevel * 1.45);
        }
        pickedUp = true;
        break;
      }
    }
    if (pickedUp) continue;
  }
}

function update(dt) {
  if (!game) return;
  const alive = [...players.values()].filter(p => p.alive);
  if (alive.length === 0) return;

  game.time += dt;
  game.waveTimer += dt;
  if (game.waveTimer >= game.waveDuration) {
    game.wave++;
    game.waveTimer = 0;
    // Match shared/sim/waves.js: 0.90 decay (wave 9 balance pass).
    game.spawnRate = Math.max(0.25, 2.0 * Math.pow(0.90, game.wave - 1));
  }

  game.spawnTimer -= dt;
  if (game.spawnTimer <= 0) {
    const special = SPECIAL_WAVES[game.wave];
    let baseCount = 1 + Math.floor(game.wave / 2);
    baseCount = Math.floor(baseCount * (1 + (alive.length - 1) * 0.5));
    if (special) baseCount = Math.ceil(baseCount * special.countMulti);
    const count = Math.min(baseCount, 15);
    const maxEnemies = 80 + game.wave * 10 + alive.length * 20;
    const toSpawn = Math.min(count, maxEnemies - game.enemies.length);
    for (let i = 0; i < Math.max(0, toSpawn); i++) spawnEnemy(game);
    game.spawnTimer = game.spawnRate;
  }

  for (const p of players.values()) {
    if (!p.alive) continue;
    tickPlayer(game, p, dt);
  }
  tickProjectiles(game, dt);
  tickEnemies(game, dt);
  tickGems(game, dt);
}

function r1(n) { return Math.round(n * 10) / 10; }
function r2(n) { return Math.round(n * 100) / 100; }

function gameStateFor(viewerId) {
  const ps = [...players.values()].map(p => ({
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
  const gems = game.gems.map(g => ({ x: r1(g.x), y: r1(g.y), xp: g.xp }));
  const projectiles = game.projectiles.map(p => ({
    x: r1(p.x), y: r1(p.y), radius: p.radius, owner: p.owner,
  }));
  return {
    type: 'state',
    t: Date.now() / 1000,
    wave: game.wave,
    time: r1(game.time),
    kills: game.kills,
    players: ps,
    enemies, gems, projectiles,
    you: viewerId,
    arena: { w: WORLD_W, h: WORLD_H },
  };
}

function broadcast() {
  for (const [ws, p] of players) {
    try {
      ws.send(JSON.stringify(gameStateFor(p.id)));
    } catch {
      // dead socket — handled by close handler
    }
  }
}

function startLoop() {
  game = initGame();
  setInterval(() => {
    update(TICK_DT);
    broadcast();
  }, TICK_DT * 1000);
}

const wss = new WebSocketServer({ port: PORT, path: '/ws' });
wss.on('connection', (ws) => {
  const pid = nextId++;
  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      const name = String(msg.name || '').slice(0, 12).trim() || `player${pid}`;
      const weapon = ['spit', 'breath', 'charge'].includes(msg.weapon) ? msg.weapon : 'spit';
      player = makePlayer(pid, name, weapon);
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
      const weapon = ['spit', 'breath', 'charge'].includes(msg.weapon) ? msg.weapon : 'spit';
      Object.assign(player, makePlayer(pid, player.name, weapon));
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
