#!/usr/bin/env node
/**
 * Stress-test harness for survivors v1a.
 *
 * Runs v1a.html in headless Chromium via playwright, drives a scripted
 * autoplayer, samples performance metrics (fps, frame ms, GC), and can
 * inject extra enemies to probe the upper bound.
 *
 * Usage:
 *   node tests/stress.mjs                # default sweep (60s per scenario)
 *   node tests/stress.mjs --scenario=baseline
 *   node tests/stress.mjs --dump=csv     # emit csv on stdout
 *
 * Scenarios:
 *   baseline       — natural spawns, autoplay, 60s
 *   boost-enemies  — inject +200 enemies every 10s, 60s
 *   particle-rush  — spawn bursts of particles, 60s
 *   combined       — both at once, 90s
 *
 * The bot moves toward the nearest gem if alive, kites away from the
 * nearest enemy if hp < 50%. No mouse aim — pure movement.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CHROMIUM = '/home/ec2-user/.cache/ms-playwright/chromium-1217/chrome-linux/chrome';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const SCENARIO = args.scenario || 'all';
const DUMP = args.dump || 'pretty';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ogg': 'audio/ogg' };

function startServer(port) {
  return new Promise(resolve => {
    const s = createServer((req, res) => {
      let p = req.url.split('?')[0];
      if (p === '/') p = '/v1a.html';
      const f = join(ROOT, p);
      if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
      res.end(readFileSync(f));
    });
    s.listen(port, () => resolve(s));
  });
}

/** Inject the bot + perf sampler into the page. Runs inside the browser. */
async function installBot(page) {
  await page.evaluate(() => {
    // Perf sampler — rolling 1s window, captures frame intervals via rAF
    window.__perf = { frameStarts: [], samples: [] };
    let prevFrame = performance.now();
    function sample() {
      const now = performance.now();
      window.__perf.frameStarts.push(now);
      // keep 2s of frames
      while (window.__perf.frameStarts.length > 0 && now - window.__perf.frameStarts[0] > 2000) {
        window.__perf.frameStarts.shift();
      }
      prevFrame = now;
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);

    // Bot: find nearest gem, move toward it; if hp low, kite away from nearest enemy
    // We can't access the closed `game` scope, so we drive via dispatching keyboard events
    // and read state from DOM HUD + canvas.
    //
    // Strategy: simple "move in a direction" toggle every 600ms based on crude heuristics.
    // Autoplay enough to exercise the engine; not trying to win.
    window.__bot = { running: true, pressed: new Set() };
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    const keyChar = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
    function press(code) {
      if (window.__bot.pressed.has(code)) return;
      window.__bot.pressed.add(code);
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: keyChar[code], bubbles: true }));
    }
    function release(code) {
      if (!window.__bot.pressed.has(code)) return;
      window.__bot.pressed.delete(code);
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key: keyChar[code], bubbles: true }));
    }
    window.__botRelease = () => { [...window.__bot.pressed].forEach(release); };

    // Drive movement: random cardinal direction every 600ms. Good enough to keep player alive a bit.
    setInterval(() => {
      if (!window.__bot.running) return;
      const want = codes[Math.floor(Math.random() * codes.length)];
      codes.forEach(c => { if (c !== want) release(c); });
      press(want);
    }, 600);
  });
}

async function getPerf(page) {
  return await page.evaluate(() => {
    const perf = window.__perf;
    const frames = perf.frameStarts;
    if (frames.length < 2) return { fps: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
    const intervals = [];
    for (let i = 1; i < frames.length; i++) intervals.push(frames[i] - frames[i - 1]);
    intervals.sort((a, b) => a - b);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const p95 = intervals[Math.floor(intervals.length * 0.95)];
    const max = intervals[intervals.length - 1];
    const fps = intervals.length / ((frames[frames.length - 1] - frames[0]) / 1000);
    const hud = {};
    ['hud-time', 'hud-kills', 'hud-wave', 'hud-level'].forEach(id => {
      const el = document.getElementById(id);
      if (el) hud[id.replace('hud-', '')] = el.textContent.trim();
    });
    const mem = performance.memory ? {
      used: Math.round(performance.memory.usedJSHeapSize / 1048576),
      total: Math.round(performance.memory.totalJSHeapSize / 1048576),
    } : null;
    const stats = window._dev?.getStats?.() ?? null;
    // Phase buckets from ?perf=1 harness (update/render/frame + r.bg/world/player/particles/floats/hud).
    // Emits avg+p95+max per label over the last ~10s window, same math as the in-page _perfReport.
    let phases = null;
    if (window._perf?.buckets) {
      phases = {};
      for (const label of Object.keys(window._perf.buckets)) {
        const b = window._perf.buckets[label];
        if (!b || b.length === 0) continue;
        const s = [...b].sort((a, b) => a - b);
        const a = b.reduce((sum, x) => sum + x, 0) / b.length;
        phases[label] = {
          avg: +a.toFixed(2),
          p95: +s[Math.floor(s.length * 0.95)].toFixed(2),
          max: +s[s.length - 1].toFixed(2),
          n: b.length,
        };
      }
    }
    return { fps: +fps.toFixed(1), avgMs: +avg.toFixed(2), p95Ms: +p95.toFixed(2), maxMs: +max.toFixed(2), hud, mem, stats, phases };
  });
}

async function runScenario(page, name, fn, seconds) {
  const samples = [];
  // Click PLAY
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /PLAY|RETRY/.test(b.textContent));
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  const start = Date.now();
  const task = fn ? fn(page) : Promise.resolve();
  while ((Date.now() - start) / 1000 < seconds) {
    await page.waitForTimeout(1000);
    const p = await getPerf(page);
    p.elapsed = Math.round((Date.now() - start) / 1000);
    samples.push(p);
  }
  if (fn) { await task.catch(() => {}); }
  return { name, samples };
}

const scenarios = {
  // Keyboard-only scenarios (no window._dev hook required)
  baseline: {
    seconds: 60,
    setup: null,
  },
  'long-duration': {
    seconds: 300,
    setup: null,
    description: '5-min run — check for memory growth and late-game perf degradation',
  },
  'rapid-retry': {
    seconds: 60,
    setup: async (page) => {
      // Die repeatedly: simulate it by pressing RETRY every 5 seconds.
      // If listeners leak on retry, memory / fps will degrade.
      while (true) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find(b => /RETRY/.test(b.textContent));
            if (btn) btn.click();
          });
        } catch {}
      }
    },
    description: 'force game restart every 5s — detects listener/render leaks',
  },
  'viewport-4k': {
    seconds: 60,
    setup: null,
    viewport: { width: 3840, height: 2160 },
    description: '4K viewport — tests canvas scaling + draw-call cost at high res',
  },
  'viewport-mobile': {
    seconds: 60,
    setup: null,
    viewport: { width: 360, height: 640 },
    description: 'mobile viewport — small screen, touch-gated code paths',
  },
  'focus-blur': {
    seconds: 60,
    setup: async (page) => {
      // Tab blur/focus every 8s — browsers throttle rAF on blur.
      let blurred = false;
      while (true) {
        await new Promise(r => setTimeout(r, 8000));
        try {
          await page.evaluate(b => {
            if (b) window.dispatchEvent(new Event('blur'));
            else window.dispatchEvent(new Event('focus'));
          }, blurred);
          blurred = !blurred;
        } catch {}
      }
    },
    description: 'dispatch blur/focus every 8s — game should pause/resume without chaos',
  },
  'input-flood': {
    seconds: 60,
    setup: (page) => page.evaluate(() => {
      // Spam keydowns faster than the bot does. Detect handler hot-path issues.
      const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
      let i = 0;
      setInterval(() => {
        const c = codes[i++ % codes.length];
        window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c[3].toLowerCase(), bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c[3].toLowerCase(), bubbles: true }));
      }, 5);
    }),
    description: 'dispatch ~200 key events/sec — stress input pipeline',
  },

  // Density sweep — require window._dev hook in v1a.html
  'density-200': {
    seconds: 45,
    setup: (page) => page.evaluate(() => { setTimeout(() => window._dev?.spawnEnemies(200), 3000); }),
    description: 'jump to ~200 enemies at 3s',
  },
  'density-500': {
    seconds: 45,
    setup: (page) => page.evaluate(() => { setTimeout(() => window._dev?.spawnEnemies(500), 3000); }),
    description: 'jump to ~500 enemies at 3s',
  },
  'density-1000': {
    seconds: 45,
    setup: (page) => page.evaluate(() => { setTimeout(() => window._dev?.spawnEnemies(1000), 3000); }),
    description: 'jump to ~1000 enemies at 3s',
  },
  'density-2000': {
    seconds: 45,
    setup: (page) => page.evaluate(() => { setTimeout(() => window._dev?.spawnEnemies(2000), 3000); }),
    description: 'jump to ~2000 enemies at 3s (upper bound)',
  },
  'particle-rush': {
    seconds: 45,
    setup: (page) => page.evaluate(() => {
      setInterval(() => {
        const g = window._dev?.getGame();
        if (!g?.player) return;
        for (let i = 0; i < 10; i++) {
          window._dev.spawnParticles(g.player.x + (Math.random() - 0.5) * 400, g.player.y + (Math.random() - 0.5) * 400, 50);
        }
      }, 200);
    }),
    description: '~2500 particles/sec burst sustained',
  },
  'mobile-density': {
    seconds: 45,
    viewport: { width: 390, height: 844 },
    setup: (page) => page.evaluate(() => { setTimeout(() => window._dev?.spawnEnemies(500), 3000); }),
    description: 'iPhone-size viewport with 500 enemies — sam judder report scenario',
  },
  // Realistic late-game: jump to wave 15, keep player alive so update+render
  // run continuously. The dev-hook HP top-up replaces invuln without needing
  // a new game flag. Only runs on localhost (dev hook is gated there).
  'late-game': {
    seconds: 60,
    setup: (page) => page.evaluate(() => {
      setTimeout(() => {
        const g = window._dev?.getGame();
        if (!g) return;
        g.wave = 15;
        window._dev.spawnEnemies(150);
      }, 2000);
      setInterval(() => {
        const g = window._dev?.getGame();
        if (!g?.player) return;
        g.player.hp = g.player.maxHp;
        // Auto-pick level-up option 0 so the sim keeps running; without
        // this, the bot never resolves the paused level-up overlay and
        // update() stalls for the rest of the scenario.
        if (window._levelChoices && window._levelChoices[0]) {
          window._levelChoices[0]();
        }
      }, 200);
    }),
    description: 'wave 15 + 150 enemies, hp topped up — realistic late-game with live update loop',
  },
};

async function main() {
  if (args.list) {
    console.log('available scenarios:');
    for (const [name, def] of Object.entries(scenarios)) {
      console.log(`  ${name.padEnd(20)} ${def.seconds}s  ${def.description ?? ''}`);
    }
    return;
  }
  console.error('[stress] starting server on :18889 ...');
  const server = await startServer(18889);
  console.error('[stress] launching chromium ...');
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
  });

  const results = [];
  const list = SCENARIO === 'all'
    ? Object.keys(scenarios).filter(n => !['long-duration', 'boost-enemies', 'particle-rush'].includes(n))
    : [SCENARIO];
  for (const name of list) {
    if (!scenarios[name]) { console.error(`unknown scenario: ${name}`); continue; }
    const def = scenarios[name];
    console.error(`[stress] scenario: ${name} (${def.seconds}s)  ${def.description ?? ''}`);
    const ctx = await browser.newContext({ viewport: def.viewport ?? { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:18889/sp.html?perf=1', { waitUntil: 'load' });
    await installBot(page);
    const r = await runScenario(page, name, def.setup, def.seconds);
    results.push(r);
    console.error(`  done: ${r.samples.length} samples`);
    await ctx.close();
  }

  await browser.close();
  server.close();

  if (DUMP === 'csv') {
    console.log('scenario,elapsed,fps,avgMs,p95Ms,maxMs,memUsedMB,memTotalMB,hudTime,hudKills,hudWave,hudLevel');
    for (const { name, samples } of results) {
      for (const s of samples) {
        console.log([name, s.elapsed, s.fps, s.avgMs, s.p95Ms, s.maxMs, s.mem?.used ?? '', s.mem?.total ?? '', s.hud?.time ?? '', s.hud?.kills ?? '', s.hud?.wave ?? '', s.hud?.level ?? ''].join(','));
      }
    }
  } else {
    for (const { name, samples } of results) {
      console.log(`\n=== ${name} ===`);
      const last = samples[samples.length - 1] || {};
      const fpsVals = samples.map(s => s.fps).filter(f => f > 0);
      const minFps = Math.min(...fpsVals);
      const avgFps = fpsVals.reduce((a, b) => a + b, 0) / fpsVals.length;
      const maxMs = Math.max(...samples.map(s => s.maxMs));
      console.log(`end state: ${last.hud?.time ?? '?'} | ${last.hud?.kills ?? '?'} | ${last.hud?.wave ?? '?'} | ${last.hud?.level ?? '?'}`);
      console.log(`fps: min=${minFps.toFixed(1)} avg=${avgFps.toFixed(1)} samples=${samples.length}`);
      console.log(`frame ms: worst p95=${Math.max(...samples.map(s => s.p95Ms)).toFixed(1)} worst max=${maxMs.toFixed(1)}`);
      if (last.mem) console.log(`mem: ${last.mem.used}MB used / ${last.mem.total}MB total`);
      if (last.stats) console.log(`entities at end: enemies=${last.stats.enemies} proj=${last.stats.projectiles} particles=${last.stats.particles} gems=${last.stats.gems}`);
      if (last.phases) {
        const order = ['update', 'render', 'frame', 'r.bg', 'r.gems', 'r.auras', 'r.enemies', 'r.projectiles', 'r.worldfx', 'r.player', 'r.particles', 'r.floats', 'r.hud'];
        const seen = new Set(order);
        const extras = Object.keys(last.phases).filter(l => !seen.has(l));
        const labels = order.filter(l => last.phases[l]).concat(extras);
        console.log('phases (avg/p95/max ms):');
        for (const l of labels) {
          const p = last.phases[l];
          console.log(`  ${l.padEnd(13)} avg=${p.avg.toFixed(2).padStart(5)} p95=${p.p95.toFixed(2).padStart(5)} max=${p.max.toFixed(2).padStart(6)} n=${p.n}`);
        }
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
