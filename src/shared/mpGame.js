// MP game bootstrap — multiplayer client init + snapshot consumer.
//
// Per docs/BOOTSTRAP-UNIFICATION.md step 4, the MP-specific init
// currently inlined in src/mp-main.js will move here:
//   - WebSocket connect + reconnect (connectWS)
//   - lobby render + map voting
//   - snapshot consumer + lerp interpolation
//   - sendInput, joinGame, respawnGame
//   - showLevelUpChoices (server-supplied)
//   - showDeathScreen + showSpectateOverlay
//   - mainLoop(ts) requestAnimationFrame loop (no sim, just render)
//   - HUD surfaces: minimap, killFeed, scoreboard
//
// Today this is an empty stub — mp-main.js still bootstraps itself.
// Step 4 PR will move the bodies; step 5 PR will reduce mp-main.js to
// a `bootstrap({isMP:true})` call site.
export function bootMPGame() {
  // Step 4: move MP init from mp-main.js here.
  return {};
}
