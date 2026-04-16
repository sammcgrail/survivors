// Shared level-up choice building. SP (main.js) runs this client-side;
// MP (mp-main.js) receives server-computed choices via the `levelup`
// message instead (server.mjs runs the same Fisher-Yates logic at
// server.mjs:200–205 so the pool/weight behavior stays in sync).
//
// Kept here so SP changes to the shuffle or slice size can't drift
// from the server without also touching this module.

import { getAvailableChoices } from './sim/powerups.js';

// Shuffle the eligible powerup pool and return the first `count`
// entries. Uses Math.random — client-side display randomness only;
// server uses its own seeded RNG for MP so results can differ.
export function buildLevelUpChoices(stacks, count = 3) {
  const available = getAvailableChoices(stacks);
  // Fisher-Yates shuffle. The sort(() => Math.random()-0.5) one-liner
  // is biased and doesn't even produce a uniform distribution.
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  return available.slice(0, count);
}
