// ============================================================
// SURVIVORS v1a — single-player client entry point
// Bundled by scripts/build.cjs → bundle.js (loaded by v1a.html)
// ============================================================

import { bootSharedServices } from './shared/boot.js';
import { bootSPGame } from './shared/spGame.js';

// --- shared bootstrap (wires toggleVolPanel, bestiary, mute, bgm, sfx) ---
bootSharedServices({ isMP: false });

// --- SP game init (all game state, loop, UI, input, rendering) ---
bootSPGame();
