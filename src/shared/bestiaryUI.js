// Bestiary overlay UI — shared between SP (main.js) and MP (mp-main.js).
// Reads enemy catalog from getBestiaryEntries() and renders into
// #bestiary / #bestiary-grid / #bestiary-progress DOM nodes.

import { getBestiaryEntries } from './bestiary.js';
import { escapeHTML } from './htmlEscape.js';

export function showBestiary() {
  const overlay = document.getElementById('bestiary');
  const grid = document.getElementById('bestiary-grid');
  const progress = document.getElementById('bestiary-progress');
  const entries = getBestiaryEntries();
  const seen = entries.filter(e => e.firstWave !== null).length;
  if (progress) progress.textContent = `${seen} / ${entries.length} discovered`;
  grid.innerHTML = entries.map(e => {
    if (e.firstWave === null) {
      return `<div class="beast-card unseen">
        <div class="beast-swatch unseen"></div>
        <div class="beast-name">???</div>
        <div class="beast-wave">undiscovered</div>
        <div class="beast-stats">hp - · spd - · dmg -</div>
        <div class="beast-desc">Keep playing to unlock.</div>
      </div>`;
    }
    return `<div class="beast-card">
      <div class="beast-swatch" style="background:${e.color}; color:${e.color};"></div>
      <div class="beast-name">${escapeHTML(e.info.display)}</div>
      <div class="beast-wave">first seen: wave ${e.firstWave}</div>
      <div class="beast-stats">hp ${e.baseStats.hp} · spd ${e.baseStats.speed} · dmg ${e.baseStats.damage}</div>
      <div class="beast-desc">${escapeHTML(e.info.desc)}</div>
    </div>`;
  }).join('');
  overlay.style.display = 'flex';
}

export function hideBestiary() {
  document.getElementById('bestiary').style.display = 'none';
}
