// Top-run weapon frequency — aggregates the `weapons` arrays from
// leaderboard runs. **Survivorship-biased on purpose**: `/leaderboard`
// only ships completed/top runs, so this view measures "what weapons
// appear in the loadouts that reach the board", not raw pick rate.
// When we have a `/stats/weapons` endpoint that joins picks to
// outcomes we can add a true pick-rate + win-rate view; until then
// honest framing is a survivorship-biased frequency.
//
// Pure aggregation lives here; DOM in renderWeaponHistogram below.
// Shared between SP debug overlay and any future MP surface.
import { WEAPON_ICONS, WEAPON_ROLE, WEAPON_EVO_SOURCES } from './weapons.js';

// Build a reverse map: base weapon → evolution it resolved into for
// this run's loadout. Used by the "rollup" mode below so a run that
// took `chain` + `lightning_field` and evolved to `thunder_god`
// doesn't undercount the chain/field families (they'd otherwise drop
// off the histogram because the evolution consumed them).
const EVO_TO_SOURCES = WEAPON_EVO_SOURCES;

// Per-run weapon expansion for rollup mode: a `thunder_god` entry
// counts as `thunder_god` + `chain` + `lightning_field` so the source
// families stay visible in the histogram.
function rollupWeapons(weapons) {
  const out = new Set();
  for (const w of weapons) {
    out.add(w);
    const sources = EVO_TO_SOURCES[w];
    if (sources) {
      for (const s of sources) out.add(s);
    }
  }
  return [...out];
}

// Returns { rows, totalRuns, mode }. `mode` is 'asRecorded' (raw)
// or 'rollup' (evolutions count toward their source pair too).
// Weapons never seen are omitted. Rows sorted by frequency desc.
export function computeWeaponHistogram(runs, opts = {}) {
  const mode = opts.mode === 'rollup' ? 'rollup' : 'asRecorded';
  const count = {};
  for (const run of runs) {
    const weapons = run.weapons || [];
    const expanded = mode === 'rollup' ? rollupWeapons(weapons) : weapons;
    for (const w of expanded) count[w] = (count[w] || 0) + 1;
  }
  const rows = Object.keys(count).map(w => ({
    weapon: w,
    runs: count[w],
    share: runs.length > 0 ? count[w] / runs.length : 0,
    icon: WEAPON_ICONS[w] || '?',
    role: WEAPON_ROLE[w] || 'OTHER',
  }));
  // Sort by run-appearance desc, then role for stable-secondary so
  // two evos at the same count don't flip-flop per refresh.
  rows.sort((a, b) => b.runs - a.runs || a.role.localeCompare(b.role));
  return { rows, totalRuns: runs.length, mode };
}

// Render a CSS-bar histogram. No charting lib — div widths scaled to
// the max frequency in the set. Returns the computed histogram so the
// caller can also show aggregate numbers elsewhere.
export function renderWeaponHistogram(containerEl, runs, opts = {}) {
  const hist = computeWeaponHistogram(runs, opts);
  if (hist.rows.length === 0) {
    containerEl.innerHTML = '<div class="wph-empty">no runs yet</div>';
    return hist;
  }
  const maxCount = hist.rows[0].runs;
  const pctOf = (n) => maxCount > 0 ? Math.round((n / maxCount) * 100) : 0;
  const rowsHtml = hist.rows.map(r => `
    <div class="wph-row">
      <div class="wph-label">
        <span class="wph-icon">${r.icon}</span>
        <span class="wph-name">${r.weapon.replace(/_/g, ' ')}</span>
        <span class="wph-role">${r.role}</span>
      </div>
      <div class="wph-bar-track">
        <div class="wph-bar" style="width:${pctOf(r.runs)}%"></div>
        <div class="wph-picks">${r.runs} · ${(r.share * 100).toFixed(0)}%</div>
      </div>
    </div>
  `).join('');
  const modeLabel = hist.mode === 'rollup'
    ? 'rollup (evolutions count toward source pair)'
    : 'as-recorded';
  containerEl.innerHTML = `
    <div class="wph-head">
      <span class="wph-title">Top-run weapon frequency · ${hist.totalRuns} runs</span>
      <span class="wph-sub">${modeLabel}</span>
    </div>
    <div class="wph-rows">${rowsHtml}</div>
    <div class="wph-foot">survivorship-biased: only completed/top runs ship to /leaderboard</div>
  `;
  return hist;
}
