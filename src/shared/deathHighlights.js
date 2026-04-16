// Derived run highlights for the death screen: MVP weapon, biggest
// single hit, overkill count. Pure derivation from per-player stats
// that `damage.js` writes during the run — SP passes `g.player`, MP
// passes the snapshot's "me" object. Both paths must carry the same
// fields (dmgByWeapon / maxHit / maxHitEnemy / overkills).
//
// DOM-rendering here rather than in main.js / mp-main.js so the card
// layout doesn't drift between runtimes (anti-drift invariant #5 in
// src/shared/README.md — same shared-decoration rationale as
// levelUpCard.js).
import { WEAPON_ICONS, WEAPON_ROLE } from './weapons.js';

// Returns { mvp: {weapon, dmg, icon, role} | null, maxHit, maxHitEnemy, overkills }.
// `mvp` null when the player dealt zero damage (e.g. died instantly).
export function computeDeathHighlights(p) {
  const byWeapon = p.dmgByWeapon || {};
  let mvpType = null, mvpDmg = 0;
  for (const [type, dmg] of Object.entries(byWeapon)) {
    // Skip non-weapon damage buckets like 'bomb' / 'other' / 'status' —
    // they're valid damage sources but shouldn't compete for MVP of a
    // weapons-focused build summary.
    if (!WEAPON_ROLE[type]) continue;
    if (dmg > mvpDmg) { mvpDmg = dmg; mvpType = type; }
  }
  const mvp = mvpType ? {
    weapon: mvpType,
    dmg: Math.round(mvpDmg),
    icon: WEAPON_ICONS[mvpType] || '?',
    role: WEAPON_ROLE[mvpType] || 'AURA',
  } : null;
  return {
    mvp,
    maxHit: Math.round(p.maxHit || 0),
    maxHitEnemy: p.maxHitEnemy || null,
    overkills: p.overkills || 0,
  };
}

// Inject the highlight cards into a container. Empty containers render
// nothing (caller should not show a blank panel). Returns the number
// of cards actually rendered so callers can hide the wrapper if 0.
export function renderDeathHighlights(containerEl, p) {
  const h = computeDeathHighlights(p);
  const cards = [];
  if (h.mvp) {
    cards.push(`
      <div class="highlight hl-mvp">
        <div class="hl-label">MVP weapon</div>
        <div class="hl-value">${h.mvp.icon} ${h.mvp.dmg.toLocaleString()} dmg</div>
        <div class="hl-role">${h.mvp.role}</div>
      </div>
    `);
  }
  if (h.maxHit > 0) {
    cards.push(`
      <div class="highlight">
        <div class="hl-label">Biggest hit</div>
        <div class="hl-value">${h.maxHit.toLocaleString()}</div>
        ${h.maxHitEnemy ? `<div class="hl-sub">to ${h.maxHitEnemy}</div>` : ''}
      </div>
    `);
  }
  if (h.overkills > 0) {
    cards.push(`
      <div class="highlight">
        <div class="hl-label">Overkills</div>
        <div class="hl-value">${h.overkills}</div>
      </div>
    `);
  }
  containerEl.innerHTML = cards.join('');
  return cards.length;
}
