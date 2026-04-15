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
  // Row 2 (boss, brute, elite, spawner) are un-drawn placeholders —
  // near-black background pixels, not real sprites. Omitted so
  // drawSprite returns false and the colored-circle fallback renders.
  // TODO: draw actual sprites for these enemy types.
};
