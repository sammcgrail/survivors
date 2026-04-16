// SP game bootstrap — single-player init + game loop wiring.
//
// Per docs/BOOTSTRAP-UNIFICATION.md step 3, the SP-specific init
// currently inlined in src/main.js will move here:
//   - start screen + map picker + prestige shop bindings
//   - selectWeapon / selectMap / startGame handlers
//   - initGame(): per-run sim setup
//   - showLevelUp / showDeathScreen
//   - update(dt) sim tick
//   - gameLoop(ts) requestAnimationFrame loop
//   - perf-mark harness (?perf=1)
//
// Today this is an empty stub — main.js still bootstraps itself.
// Step 3 PR will move the bodies; step 5 PR will reduce main.js to a
// `bootstrap({isMP:false})` call site.
//
// Returning an object lets the bootstrap caller hold a handle for
// future programmatic teardown / hot-reload, even though there's no
// caller using it yet.
export function bootSPGame() {
  // Step 3: move SP init from main.js here.
  return {};
}
