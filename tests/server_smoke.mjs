#!/usr/bin/env node
// Smoke test for the Node MP server (server.mjs). Boots a single fake
// client, joins, holds D for ~1s, asserts welcome + state shape.
//
// Run with: node tests/server_smoke.mjs
// (assumes server.mjs is already running on port 7700, or set SURVIVORS_PORT)
import { WebSocket } from 'ws';

const PORT = Number(process.env.SURVIVORS_PORT) || 7700;
const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const states = [];
let welcome = null;

function fail(msg) { console.error('FAIL ' + msg); process.exit(1); }

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'join', name: 'smoke', weapon: 'spit' }));
  setTimeout(() => ws.send(JSON.stringify({ type: 'input', keys: { right: true } })),  100);
  setTimeout(() => ws.send(JSON.stringify({ type: 'input', keys: {} })),               1100);
  setTimeout(finish, 2500);
});

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg.type === 'welcome') welcome = msg;
  else if (msg.type === 'state') states.push(msg);
});

ws.on('error', (e) => fail('socket error: ' + e.message));

function finish() {
  ws.close();
  let failed = false;
  function check(cond, msg) {
    if (cond) console.log(`  ok    ${msg}`);
    else { console.error(`  FAIL  ${msg}`); failed = true; }
  }

  console.log(`server smoke (port ${PORT}, ${states.length} state msgs):`);
  check(welcome !== null, 'received welcome');
  check(welcome && welcome.you === 0, 'welcome.you === 0');
  check(welcome && welcome.color, 'welcome has color');
  check(states.length >= 20, `received ≥20 state messages (got ${states.length})`);
  if (states.length === 0) { process.exit(1); }

  const first = states[0];
  const last = states[states.length - 1];
  const me = last.players.find(p => p.id === 0);
  const meStart = first.players.find(p => p.id === 0);
  check(me, 'state.players includes me');
  check(me && me.alive, 'me is alive');
  // Spawn jitter is ±200 around world centre, so an absolute x-target is
  // flaky; assert the player actually moved right relative to spawn.
  check(me && meStart && me.x > meStart.x + 50, `me moved right (Δx=${(me?.x - meStart?.x).toFixed(1)} > 50)`);
  check(last.wave === 1, `wave 1 (got ${last.wave})`);
  check(Array.isArray(last.enemies), 'state.enemies is array');
  check(last.arena && last.arena.w === 3000, 'arena dims included');

  console.log(`\n  observed wave ${last.wave}, time ${last.time}, ${last.enemies.length} enemies, ${last.gems.length} gems, ${last.projectiles.length} projectiles, ${last.kills} kills`);
  if (failed) process.exit(1);
  console.log('\nserver smoke OK');
  process.exit(0);
}
