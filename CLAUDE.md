# Survivors

Vampire-survivors-style web game with single-player and multiplayer modes. ES modules bundled by esbuild; Node WebSocket server for MP.

## Architecture

- **`src/shared/sim/`** — pure simulation, runs in both SP (browser) and MP (Node server). Operates on `g.players[]`; SP wraps `[g.player]`, MP uses real array. Emits typed events to `g.events`; clients drain for sfx/particles.
- **`src/main.js`** — SP entry. Bundled to `bundle.js` and rendered into `sp.html`.
- **`src/mp-main.js`** — MP entry (WebSocket client). Bundled to `bundle-mp.js` into `mp.html`.
- **`server.mjs`** — MP server. Imports `tickSim` from shared and broadcasts state at 20Hz.
- **`template.html`** — shared HTML; `scripts/render-html.cjs` produces `sp.html` + `mp.html` from it.
- **`src/shared/maps.js`** — map catalog (arena/forest/ruins/graveyard) with obstacles + tilesets.
- **`SPECS.md`** — feature specs.

## Commands

```
npm run build       # bundle SP + MP, render html
npm run smoke       # sim smoke (no server)
npm run mp-smoke    # server smoke (needs `node server.mjs` running on :7700)
node server.mjs     # MP server
```

## Conventions

- **Run `/simplify` on every diff before committing** — dedupe between SP/MP renders, kill stale comments, collapse near-duplicate weapon ticks. PRs without a /simplify pass create cleanup churn.
- Sim modules are pure: no DOM, no canvas, no Date. Use `g.rng` for any randomness so server and client stay deterministic.
- Per-player state lives on the player object (e.g. `p.powerupStacks`), never as module globals — MP requires it.
- New weapons: add to `createWeapon()` in `src/shared/weapons.js`, fire/tick in `src/shared/sim/weapons_runtime.js`, render in BOTH `src/main.js` and `src/mp-main.js`.
- Bundle files (`bundle.js`, `bundle-mp.js`, `sp.html`, `mp.html`) are committed alongside source; rebuild before commit.
