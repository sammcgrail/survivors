#!/usr/bin/env node
/**
 * Survivors build script. Bundles src/main.js → bundle.js via esbuild.
 *
 * Usage:
 *   node scripts/build.cjs          # production build (minified)
 *   node scripts/build.cjs --watch  # dev: unminified + sourcemap, rebuild on change
 *   node scripts/build.cjs --dev    # dev one-shot (unminified + sourcemap)
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { writePages } = require('./render-html.cjs');

const ROOT = path.resolve(__dirname, '..');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

const targets = [
  { entry: 'src/main.js',    out: 'bundle.js' },
  { entry: 'src/mp-main.js', out: 'bundle-mp.js' },
];
const baseOpts = {
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  logLevel: 'info',
  minify: !dev,
  sourcemap: dev ? 'linked' : false,
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
    writePages();
  }
})().catch(err => { console.error(err); process.exit(1); });
