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
};

// Level-up card icon HTML — returns a sprite-backed <span> if `id`
// matches a key in SP, else the fallback emoji glyph. Keeps emoji
// parity on keys we haven't sprited yet (stat powerups, relics).
// Sheet dimensions: 128×96, scaled 2x to 256×192 for display.
export function powerupIconHTML(id, fallback) {
  const sp = SP[id];
  if (!sp) return fallback;
  return `<span class="sprite-icon" style="background-position:${-sp[0] * 32}px ${-sp[1] * 32}px"></span>`;
}
