#!/usr/bin/env node
/**
 * Survivors build script. Bundles src/main.js → bundle.js via esbuild.
 *
 * Usage:
 *   node scripts/build.js          # one-shot build
 *   node scripts/build.js --watch  # rebuild on file change
 *
 * The output sits at the repo root next to v1a.html so Caddy / CF Pages
 * keep serving from the same place. No dist/ directory yet — kept simple
 * for the first modularization PR.
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

// Two bundles: v1a single-player and v1b multiplayer client.
// Both pull from src/shared/ for one-source-of-truth on game data.
const targets = [
  { entry: 'src/main.js',     out: 'bundle.js' },
  { entry: 'src/v1b-main.js', out: 'bundle-v1b.js' },
];
const baseOpts = {
  bundle: true,
  format: 'iife',
  sourcemap: 'linked',
  target: ['es2020'],
  logLevel: 'info',
};

(async () => {
  if (watch) {
    for (const t of targets) {
      const ctx = await esbuild.context({ ...baseOpts, entryPoints: [path.join(ROOT, t.entry)], outfile: path.join(ROOT, t.out) });
      await ctx.watch();
    }
    console.log('[build] watching src/...');
  } else {
    for (const t of targets) {
      await esbuild.build({ ...baseOpts, entryPoints: [path.join(ROOT, t.entry)], outfile: path.join(ROOT, t.out) });
      const stat = fs.statSync(path.join(ROOT, t.out));
      console.log(`[build] ${t.out} ${(stat.size / 1024).toFixed(1)} kB`);
    }
  }
})().catch(err => { console.error(err); process.exit(1); });
