#!/usr/bin/env node
/**
 * Build-time HTML renderer. The canonical page lives in `template.html`
 * (edit that file for any UI change). Build substitutes three
 * placeholders to produce sp.html (single-player) and mp.html
 * (multiplayer). Every other byte is shared between the two.
 *
 * Placeholders: {{TITLE}}, {{MODE}}, {{BUNDLE}}.
 *
 * Run standalone: `node scripts/render-html.cjs`
 * Or as part of: `npm run build` (build.cjs invokes this after bundling).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'template.html');

const PAGES = [
  { out: 'sp.html', mode: 'sp', title: 'survivors',    bundle: 'bundle.js' },
  { out: 'mp.html', mode: 'mp', title: 'survivors mp', bundle: 'bundle-mp.js' },
];

function render(page) {
  return fs.readFileSync(TEMPLATE, 'utf8')
    .replace(/{{TITLE}}/g,  page.title)
    .replace(/{{MODE}}/g,   page.mode)
    .replace(/{{BUNDLE}}/g, page.bundle);
}

function writePages() {
  for (const page of PAGES) {
    fs.writeFileSync(path.join(ROOT, page.out), render(page));
  }
  console.log(`[render-html] wrote ${PAGES.map(p => p.out).join(', ')} from template.html`);
}

if (require.main === module) writePages();

module.exports = { render, writePages, PAGES };
