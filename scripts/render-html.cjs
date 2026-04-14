#!/usr/bin/env node
/**
 * Build-time HTML renderer. v1a.html (SP) and v1b.html (MP) are emitted
 * from a single template — the only template variables are the title,
 * the `data-mode` attribute on <body>, and the bundle script src. Every
 * other byte is identical.
 *
 * The body contains the UNION of all UI elements (start screen, level-up
 * modal, death screen, conn-status banner). CSS scopes visibility by
 * `body[data-mode="..."]` so each mode shows only its relevant parts.
 *
 * Run standalone: `node scripts/render-html.cjs`
 * Or as part of: `npm run build` (build.cjs invokes this after bundling).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Weapon card data — same set in start screen + death-screen respawn picker.
// dragon_storm is an evolution (spit + breath fused) and isn't a starting
// choice, so it's excluded.
const WEAPONS = [
  { id: 'spit',            icon: '&#x1F52E;',          name: 'Magic Spit',      desc: 'Projectile — fires at the nearest enemy' },
  { id: 'breath',          icon: '&#x1F300;',          name: 'Dragon Breath',   desc: 'Aura — damages all nearby enemies' },
  { id: 'charge',          icon: '&#x1F402;',          name: 'Bull Rush',       desc: 'Sweep — charges in your move direction' },
  { id: 'orbit',           icon: '&#x1F5E1;&#xFE0F;',  name: 'Blade Orbit',     desc: 'Orbiting blades damage enemies on contact' },
  { id: 'chain',           icon: '&#x26A1;',           name: 'Chain Lightning', desc: 'Zaps nearest enemy, chains to 2 more' },
  { id: 'meteor',          icon: '&#x2604;&#xFE0F;',   name: 'Meteor',          desc: 'Drops AoE blasts on enemy clusters' },
  { id: 'shield',          icon: '&#x1F6E1;&#xFE0F;',  name: 'Barrier',         desc: 'Knockback shield — pushes and damages nearby' },
  { id: 'lightning_field', icon: '&#x26A1;',           name: 'Lightning Field', desc: 'Passive — zaps random nearby enemies' },
];

function weaponCards(containerId) {
  return WEAPONS.map((w, i) =>
    `    <div class="weapon-card${i === 0 ? ' selected' : ''}" data-weapon="${w.id}" onclick="selectWeapon('${w.id}')">\n` +
    `      <div class="wc-icon">${w.icon}</div>\n` +
    `      <div class="wc-name">${w.name}</div>\n` +
    `      <div class="wc-desc">${w.desc}</div>\n` +
    `    </div>`
  ).join('\n');
}

function render(mode) {
  if (mode !== 'sp' && mode !== 'mp') throw new Error(`bad mode: ${mode}`);
  const title  = mode === 'sp' ? 'survivors v1a' : 'survivors v1b';
  const bundle = mode === 'sp' ? 'bundle.js'     : 'bundle-v1b.js';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" type="image/png" href="favicon.png">
<link rel="icon" type="image/x-icon" href="favicon.ico">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&family=Orbitron:wght@700;900&display=swap" rel="stylesheet">
<title>${title}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0a0a0f; color: #ccc; font-family: 'Chakra Petch', 'Segoe UI', sans-serif; overflow: hidden; height: 100vh; display: flex; align-items: center; justify-content: center; }
canvas { display: block; image-rendering: pixelated; }

/* mode visibility — body[data-mode] gates which blocks render */
body[data-mode="sp"] .mp-only { display: none !important; }
body[data-mode="mp"] .sp-only { display: none !important; }

#ui { position: fixed; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; padding: 8px 16px; font-size: 0.85rem; font-weight: 600; color: #aaa; text-shadow: 0 1px 3px rgba(0,0,0,0.8); pointer-events: none; z-index: 10; }
#ui .left, #ui .right { display: flex; gap: 16px; }

#level-up { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); display: none; flex-direction: column; align-items: center; justify-content: center; z-index: 20; }
#level-up h2 { color: #f1c40f; margin-bottom: 24px; font-size: 2rem; font-family: 'Orbitron', sans-serif; font-weight: 900; text-shadow: 0 0 20px rgba(241,196,15,0.5); letter-spacing: 4px; }
#level-up .choices { display: flex; gap: 16px; }
#level-up .choice { background: #181825; border: 2px solid #333; border-radius: 8px; padding: 20px; width: 180px; cursor: pointer; text-align: center; transition: border-color 0.15s; }
#level-up .choice:hover { border-color: #f1c40f; }
#level-up .choice .name { color: #f1c40f; font-size: 1rem; font-weight: 700; margin-bottom: 8px; }
#level-up .choice .desc { color: #999; font-size: 0.8rem; line-height: 1.5; }

#conn-status { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); border: 1px solid #444; color: #f39c12; padding: 6px 14px; font-size: 0.75rem; border-radius: 4px; z-index: 25; display: none; }

#start-screen, #death-screen { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.9); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 30; }
#death-screen { display: none; }
#start-screen h1, #death-screen h1 { color: #e74c3c; font-size: 3rem; font-family: 'Orbitron', sans-serif; font-weight: 900; letter-spacing: 6px; text-shadow: 0 0 30px rgba(231,76,60,0.6); margin-bottom: 8px; }
#start-screen .sub { color: #777; font-size: 0.85rem; margin-bottom: 32px; }
#start-screen input, .name-input { background: #181825; border: 2px solid #333; color: #eee; padding: 6px 14px; font-family: inherit; font-size: 0.9rem; border-radius: 4px; text-align: center; outline: none; width: 220px; margin-bottom: 16px; }
#start-screen input:focus { border-color: #e74c3c; }
#start-screen button, #death-screen button { background: #e74c3c; border: none; color: #fff; padding: 12px 40px; font-family: inherit; font-size: 1rem; border-radius: 6px; cursor: pointer; }
#start-screen button:hover, #death-screen button:hover { background: #c0392b; }

#death-screen .stats { color: #aaa; font-size: 1rem; margin-bottom: 16px; text-align: center; line-height: 2; }
#death-screen .best-run { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 10px 20px; margin-bottom: 16px; text-align: center; font-size: 0.75rem; color: #666; }
#death-screen .best-run .best-label { text-transform: uppercase; letter-spacing: 2px; font-size: 0.6rem; color: #555; margin-bottom: 4px; }
#death-screen .best-run .best-value { color: #f39c12; font-size: 0.85rem; }
#death-screen .new-best { color: #f1c40f; font-size: 0.8rem; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 8px; animation: bestPulse 0.6s ease-in-out infinite alternate; }
@keyframes bestPulse { from { text-shadow: 0 0 8px rgba(241,196,15,0.4); opacity: 0.8; } to { text-shadow: 0 0 20px rgba(241,196,15,0.8); opacity: 1; } }
#death-screen .loadout { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; justify-content: center; }
#death-screen .loadout-item { background: #181825; border: 1px solid #333; border-radius: 6px; padding: 6px 12px; font-size: 0.75rem; color: #aaa; }
#death-screen .loadout-item .li-icon { margin-right: 4px; }
#death-screen .loadout-label { color: #666; font-size: 0.7rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 2px; }
#death-screen .leaderboard { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; width: 320px; max-width: 90vw; }
#death-screen .leaderboard .lb-title { text-transform: uppercase; letter-spacing: 2px; font-size: 0.6rem; color: #555; margin-bottom: 8px; text-align: center; }
#death-screen .leaderboard .lb-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 0.72rem; color: #888; border-bottom: 1px solid #222; }
#death-screen .leaderboard .lb-row:last-child { border-bottom: none; }
#death-screen .leaderboard .lb-row.lb-you { color: #f1c40f; font-weight: 700; }
#death-screen .leaderboard .lb-rank { width: 24px; color: #555; }
#death-screen .leaderboard .lb-row.lb-you .lb-rank { color: #f1c40f; }
#death-screen .leaderboard .lb-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#death-screen .leaderboard .lb-wave { width: 36px; text-align: right; }
#death-screen .leaderboard .lb-kills { width: 44px; text-align: right; }
#death-screen .leaderboard .lb-time { width: 40px; text-align: right; color: #555; }
#death-screen .lb-placement { text-align: center; font-size: 0.75rem; color: #f39c12; margin-bottom: 6px; }

.weapon-select { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; justify-content: center; max-width: 90vw; }
.weapon-card { background: #181825; border: 2px solid #333; border-radius: 8px; padding: 16px 20px; width: 170px; cursor: pointer; text-align: center; transition: border-color 0.15s, transform 0.1s; }
.weapon-card:hover { border-color: #e74c3c; transform: translateY(-2px); }
.weapon-card.selected { border-color: #e74c3c; background: #1a1020; }
.weapon-card .wc-icon { font-size: 1.8rem; margin-bottom: 6px; }
.weapon-card .wc-name { color: #e74c3c; font-size: 0.95rem; font-weight: 700; margin-bottom: 4px; }
.weapon-card .wc-desc { color: #777; font-size: 0.7rem; line-height: 1.4; }
@media (pointer: coarse) {
  .weapon-select { flex-direction: column; align-items: center; gap: 10px; }
  .weapon-card { width: 240px; padding: 12px; }
}

#xp-bar { position: fixed; bottom: 0; left: 0; right: 0; height: 6px; background: #111; z-index: 10; }
#xp-fill { height: 100%; background: #3498db; width: 0%; transition: width 0.15s; }

html, body { touch-action: manipulation; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; overscroll-behavior: none; }
canvas { touch-action: none; }
#joystick-zone { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 15; display: none; }
#touch-hint { position: fixed; bottom: 20%; left: 50%; transform: translateX(-50%); color: rgba(255,255,255,0.4); font-size: 0.8rem; pointer-events: none; z-index: 16; display: none; transition: opacity 1s; }
@media (pointer: coarse) {
  #joystick-zone { display: block; }
  #touch-hint { display: block; }
  #level-up .choices { flex-direction: column; gap: 10px; }
  #level-up .choice { width: 260px; padding: 14px; }
}
</style>
</head>
<body data-mode="${mode}">

<div id="joystick-zone"></div>
<div id="touch-hint">drag anywhere to move</div>

<div id="ui">
  <div class="left">
    <span id="hud-time">0:00</span>
    <span id="hud-level">Lv 1</span>
    <span id="hud-kills">0 kills</span>
  </div>
  <div class="right">
    <span id="hud-wave">Wave 1</span>
    <span id="hud-weapons"></span>
  </div>
</div>

<canvas id="c"></canvas>

<div id="xp-bar"><div id="xp-fill"></div></div>

<div id="conn-status" class="mp-only">CONNECTING...</div>

<div id="start-screen">
  <h1>SURVIVORS</h1>
  <div class="sub sp-only">vampire survivors battle royale — single player</div>
  <div class="sub mp-only">vampire survivors multiplayer</div>
  <input type="text" id="name-input" maxlength="12" placeholder="your name" autocomplete="off" spellcheck="false">
  <div class="sub" style="margin-bottom:8px; color:#999;">choose your weapon</div>
  <div class="weapon-select" id="weapon-select">
${weaponCards('weapon-select')}
  </div>
  <button onclick="startGame()">PLAY</button>
  <div class="sub" style="margin-top:16px">WASD to move · auto-attack · survive</div>
</div>

<div id="level-up" class="sp-only">
  <h2>LEVEL UP</h2>
  <div class="choices" id="level-choices"></div>
</div>

<div id="death-screen">
  <h1>DEAD</h1>
  <div id="death-new-best" class="sp-only"></div>
  <div class="stats" id="death-stats"></div>
  <div class="loadout-label sp-only">loadout</div>
  <div class="loadout sp-only" id="death-loadout"></div>
  <div class="best-run sp-only" id="death-best-run"></div>
  <div id="death-lb-placement" class="sp-only"></div>
  <div class="leaderboard sp-only" id="death-leaderboard"></div>
  <div class="sub mp-only" style="margin-bottom:12px; color:#999;">choose weapon for respawn</div>
  <div class="weapon-select mp-only" id="respawn-weapon-select">
${weaponCards('respawn-weapon-select')}
  </div>
  <button onclick="startGame()">RETRY</button>
</div>

<script src="${bundle}"></script>
</body>
</html>
`;
}

function writePages() {
  fs.writeFileSync(path.join(ROOT, 'v1a.html'),  render('sp'));
  fs.writeFileSync(path.join(ROOT, 'v1b.html'),  render('mp'));
  // index.html serves at survivors.sebland.com/ — stays SP.
  fs.writeFileSync(path.join(ROOT, 'index.html'), render('sp'));
  console.log('[render-html] wrote v1a.html, v1b.html, index.html');
}

if (require.main === module) writePages();

module.exports = { render, writePages, WEAPONS };
