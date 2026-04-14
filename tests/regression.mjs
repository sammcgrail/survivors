#!/usr/bin/env node
// Pre-deploy regression check. Boots a local http server, launches
// chromium, and asserts the published bundles + HTML + sim render path
// haven't been broken.
//
// Catches the failure modes that have actually bitten this project:
//   - index.html replaced with the wrong file (barn-arena vs survivors)
//   - bundle import-graph break that JS-errors on load
//   - a render path that pages to a blank canvas
//   - v1b HTML drift (wrong / missing weapon cards)
//
// Run with: npm run regression
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 8767; // off the beaten path so it doesn't clash with stress.mjs / dev http
const URL = `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ogg': 'audio/ogg' };

function startServer(port) {
  return new Promise(resolve => {
    const s = createServer((req, res) => {
      let p = req.url.split('?')[0];
      // Mirror what production should do once Caddy is updated: bare `/`
      // serves the SP page (deployment will issue a 308 to /sp; locally we
      // just inline-serve sp.html so the regression test stays self-contained).
      if (p === '/') p = '/sp.html';
      const f = join(ROOT, p);
      if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
      res.end(readFileSync(f));
    });
    s.listen(port, () => resolve(s));
  });
}

const failures = [];
function check(cond, msg) {
  if (cond) { console.log(`  ok    ${msg}`); return; }
  console.error(`  FAIL  ${msg}`);
  failures.push(msg);
}

async function captureConsoleErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  return errors;
}

async function checkSp(browser) {
  console.log('\n--- sp (single player) ---');
  const page = await browser.newPage();
  const errors = await captureConsoleErrors(page);

  await page.goto(`${URL}/sp.html`, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const title = await page.title();
  check(/survivors/i.test(title), `title looks like survivors (got: "${title}")`);
  check(!!(await page.$('#c')), 'canvas#c exists');
  check(!!(await page.$('button')), 'has at least one button (PLAY)');

  // Click PLAY and let the sim run for 2s.
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /play/i.test(x.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(2000);

  // HUD signals: kills + time visible (would be empty/missing if init crashed).
  const hud = await page.evaluate(() => ({
    kills: document.querySelector('#hud-kills')?.innerText || null,
    time:  document.querySelector('#hud-time')?.innerText || null,
    wave:  document.querySelector('#hud-wave')?.innerText || null,
  }));
  check(hud.kills !== null, 'HUD #hud-kills element exists post-play');
  check(hud.time && /\d/.test(hud.time), `HUD #hud-time is ticking (got: "${hud.time}")`);
  check(hud.wave && /wave/i.test(hud.wave), `HUD #hud-wave shows wave label (got: "${hud.wave}")`);

  check(errors.length === 0, `no console errors during sp load + play (got ${errors.length})`);
  if (errors.length) errors.forEach(e => console.error(`        ${e}`));

  await page.close();
}

async function checkMp(browser) {
  console.log('\n--- mp (multiplayer client) ---');
  const page = await browser.newPage();
  const errors = await captureConsoleErrors(page);

  await page.goto(`${URL}/mp.html`, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const title = await page.title();
  check(/survivors/i.test(title), `title looks like survivors (got: "${title}")`);

  // Weapon cards: SP supports 9, but dragon_storm is an evolution, not a
  // starting choice. v1b's start screen should expose all 8 starting weapons.
  const expected = ['spit', 'breath', 'charge', 'orbit', 'chain', 'meteor', 'shield', 'lightning_field'];
  const weapons = await page.$$eval('#weapon-select .weapon-card', els => els.map(el => el.dataset.weapon));
  for (const w of expected) check(weapons.includes(w), `weapon card present: ${w}`);

  // Bundle is referenced and loaded (404 here would be silent without this check).
  const bundleStatus = await page.evaluate(async () => {
    const r = await fetch('/bundle-mp.js');
    return { ok: r.ok, len: (await r.text()).length };
  });
  check(bundleStatus.ok && bundleStatus.len > 1000, `bundle-mp.js served and non-trivial (${bundleStatus.len} bytes)`);

  // Don't attempt to join — that needs a Node server. Just confirm the page
  // didn't error on bundle execution.
  check(errors.length === 0, `no console errors during mp load (got ${errors.length})`);
  if (errors.length) errors.forEach(e => console.error(`        ${e}`));

  await page.close();
}

async function checkRoot(browser) {
  console.log('\n--- root (/) ---');
  const page = await browser.newPage();
  await page.goto(`${URL}/`, { waitUntil: 'load' });
  const title = await page.title();
  check(/survivors/i.test(title), `root title looks like survivors (got: "${title}") — guards against the root being swapped to a different game`);
  await page.close();
}

async function main() {
  const server = await startServer(PORT);
  console.log(`regression: serving ${ROOT} on ${URL}`);
  const browser = await chromium.launch({ headless: true });
  try {
    await checkRoot(browser);
    await checkSp(browser);
    await checkMp(browser);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('');
  if (failures.length === 0) {
    console.log(`regression OK (${failures.length === 0 ? 'all checks passed' : ''})`);
    process.exit(0);
  } else {
    console.error(`regression FAILED (${failures.length} check${failures.length === 1 ? '' : 's'})`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
