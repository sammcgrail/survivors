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

const opts = {
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true,
  outfile: path.join(ROOT, 'bundle.js'),
  format: 'iife',
  sourcemap: 'linked',
  target: ['es2020'],
  logLevel: 'info',
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log('[build] watching src/...');
  } else {
    await esbuild.build(opts);
    const stat = fs.statSync(opts.outfile);
    console.log(`[build] bundle.js ${(stat.size / 1024).toFixed(1)} kB`);
  }
})().catch(err => { console.error(err); process.exit(1); });
