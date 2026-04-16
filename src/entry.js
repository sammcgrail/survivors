// Unified bootstrap entry — single dispatch point for SP and MP.
//
// Per docs/BOOTSTRAP-UNIFICATION.md step 2, this file is currently a
// no-behavior-change scaffold. The companion `bootSharedServices`,
// `bootSPGame`, and `bootMPGame` stubs in src/shared/ provide the
// shape the bootstrap will dispatch to once steps 3 + 4 move the SP
// and MP init bodies in.
//
// Today's main.js and mp-main.js still bootstrap themselves at module
// load. That's intentional — step 2 is "introduce the scaffold
// without rewiring." Step 3 moves SP init into bootSPGame; step 4
// moves MP init into bootMPGame; step 5 reduces main.js / mp-main.js
// to single-line bootstrap() calls.
//
// Calling `bootstrap({ isMP })` today is safe but a no-op: the inner
// stubs don't yet contain real init. The function shape is locked in
// so step-3 callers can already reference `entry.js` without
// rewriting the call site when the bodies fill in.
import { bootSharedServices } from './shared/boot.js';
import { bootSPGame } from './shared/spGame.js';
import { bootMPGame } from './shared/mpGame.js';

export function bootstrap({ isMP }) {
  bootSharedServices({ isMP });
  if (isMP) return bootMPGame();
  return bootSPGame();
}
