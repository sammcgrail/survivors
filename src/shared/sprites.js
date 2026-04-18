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
};
