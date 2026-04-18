// Pure sprite-sheet metadata. The sheet is a 16px grid; each entry is the
// (col, row) position of that sprite. drawSprite() lives client-side because
// it needs the canvas context.

export const SPRITE_SIZE = 16;

export const SP = {
  player:     [0, 0],
  blob:       [1, 0],
  fast:       [2, 0],
  tank:       [3, 0],
  swarm:      [4, 0],
  gem:        [5, 0],
  heart:      [6, 0],
  spit:       [0, 1],
  spitTrail:  [1, 1],
  skull:      [5, 1],
  // Row 2 — boss-tier enemies, now with real art (barn, Apr 18).
  // Before this pass row 2 held near-black placeholders and drawSprite
  // fell back to the colored-circle renderer.
  boss:       [0, 2],
  brute:      [1, 2],
  elite:      [2, 2],
  spawner:    [3, 2],
  // Row 3 — variety-pass enemies + ground consumables (barn, Apr 18).
  // Before this pass poisoner/splitter/bomber/healer rendered as colored
  // circles; bomb/shield/magnet used emoji glyphs on a halo.
  poisoner:   [0, 3],
  splitter:   [1, 3],
  bomber:     [2, 3],
  healer:     [3, 3],
  bomb:       [4, 3],
  shield:     [5, 3],
  magnet:     [6, 3],
  // Row 4 — level-up card icons for the 9 base weapons (barn, Apr 18).
  // Keys match the powerup ids in src/shared/sim/powerups.js so the
  // card renderer can do drawSprite(choice.id, ...) with no mapping.
  // Before this pass the level-up UI used emoji glyphs (🔮 🌀 🐂 …)
  // which looked out-of-band vs the rest of the pixel-art game.
  weapon_spit:            [0, 4],
  weapon_breath:          [1, 4],
  weapon_charge:          [2, 4],
  weapon_orbit:           [3, 4],
  weapon_chain:           [4, 4],
  weapon_meteor:          [5, 4],
  weapon_shield:          [6, 4],
  weapon_lightning_field: [7, 4],
  // Row 5 — ice_lance (last base) + 7 evolution icons. Cols 7-8 reserved
  // for frost_cascade / nova_strike (ice_lance pair evos) whenever barn
  // gets to them.
  weapon_ice_lance:       [0, 5],
  evo_dragon_storm:       [1, 5],
  evo_thunder_god:        [2, 5],
  evo_meteor_orbit:       [3, 5],
  evo_fortress:           [4, 5],
  evo_inferno_wheel:      [5, 5],
  evo_void_anchor:        [6, 5],
  evo_tesla_aegis:        [7, 5],
  // Row 6 — stat powerup icons for the 9 non-weapon powerups (barn,
  // Apr 18 tier 4). Keys are `powerup_${id}` so the `magnet` stat
  // powerup doesn't collide with the `magnet` consumable sprite on
  // row 3. powerupIconHTML() checks the prefixed key first then
  // falls back to the raw id (weapon_/evo_ keys match directly).
  powerup_speed:        [0, 6],
  powerup_damage:       [1, 6],
  powerup_hp_regen:     [2, 6],
  powerup_attack_speed: [3, 6],
  // powerup_magnet intentionally omitted — barnaldo's call (Apr 18):
  // the thin gold horseshoe read too weak next to the consumable
  // drop. With this entry gone, powerupIconHTML('magnet', …) falls
  // through to `magnet` at [6,3] (the red/blue consumable), which
  // reads stronger on the level-up card. Cell (4,6) on the sheet is
  // now a dead slot — left in barn's strip since rewriting the sheet
  // to shift it out would ripple through every tier 4 entry.
  powerup_max_hp:       [5, 6],
  powerup_projectiles:  [6, 6],
  powerup_size:         [7, 6],
  powerup_armor:        [8, 6],
  // Row 7 — prestige-shop unlock icons for the 10 meta-progression
  // cards (barn, Apr 18 tier 5). Keys match the UNLOCKS ids in
  // src/shared/prestige.js. Cosmetics (skin_gold/skin_shadow/
  // trail_fire) get their own entries here; the in-game player
  // sprite swap + fx overlay live in the player renderer.
  // Before this pass the prestige shop cards used emoji glyphs
  // (🧡 🦅 👁️ 🛡️ 🔥 ❤️ ⭐ 👑 🌑 🔥).
  unlock_tough_scales: [0, 7],
  unlock_swift_wings:  [1, 7],
  unlock_keen_eyes:    [2, 7],
  unlock_thick_hide:   [3, 7],
  unlock_fury:         [4, 7],
  unlock_extra_heart:  [5, 7],
  unlock_headstart:    [6, 7],
  unlock_skin_gold:    [7, 7],
  unlock_skin_shadow:  [8, 7],
  unlock_trail_fire:   [9, 7],
};

// Level-up card icon HTML — returns a sprite-backed <span> if `id`
// matches a key in SP, else the fallback emoji glyph. Checks the
// `powerup_${id}` prefixed key first (stat powerups like `magnet`
// would collide with the consumable sprite otherwise), then falls
// back to the raw id (weapon_/evo_ keys match directly).
// Sheet dimensions: 160×128, scaled 2x to 320×256 for display.
export function powerupIconHTML(id, fallback) {
  const sp = SP[`powerup_${id}`] || SP[id];
  if (!sp) return fallback;
  return `<span class="sprite-icon" style="background-position:${-sp[0] * 32}px ${-sp[1] * 32}px"></span>`;
}

// Prestige-shop unlock card icon HTML — mirrors powerupIconHTML but
// keyed under the `unlock_` prefix so skin_gold/skin_shadow/trail_fire
// don't collide with any future `gold`/`shadow`/`fire` consumable or
// weapon sprite. Falls back to the raw id as a safety net, then the
// provided emoji glyph.
export function unlockIconHTML(id, fallback) {
  const sp = SP[`unlock_${id}`] || SP[id];
  if (!sp) return fallback;
  return `<span class="sprite-icon" style="background-position:${-sp[0] * 32}px ${-sp[1] * 32}px"></span>`;
}
