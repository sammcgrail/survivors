# Bootstrap unification — design doc

SP (`src/main.js`, 1304 LOC) and MP (`src/mp-main.js`, 1454 LOC) currently bootstrap independently. After the last session's extraction pass (`levelUpCard.js`, `deathHighlights.js`, `weaponPickHistogram.js`, `bestiaryUI.js`, `deathFeed.js`, `backgroundRenderer.js`, `hudBar.js`, `weaponDisplay.js`, `gameState.js`, `levelUp.js`, `particles.js`, `sfx.js`, `bgm.js`) most of the render and UI machinery is shared — but the entry files still diverge on the core loop shape and a handful of mode-specific surfaces.

This doc proposes a seam plan so a single entry module takes an `{ isMP: boolean }` option and dispatches the mode-specific branches. The target is "thin SP/MP entry stubs that import a shared bootstrap" — not a full rewrite of either runtime.

> **Assumption**: calne's music orchestration pass (P1a) lands first. Its inventory below is post-extract.

## Fundamentally divergent (do not unify)

These shouldn't be collapsed. `isMP` flag doesn't help — the code paths are too different:

- **`update(dt)` (SP) vs WebSocket state consumer (MP)**. SP runs `tickSim` locally and mutates its `g`; MP reads `state` snapshots over a socket and renders them. Different data ownership, different rate, different failure modes. Keep both, dispatch from the shared loop.
- **Level-up choice source**. SP's `showLevelUp(g)` picks from `POWERUPS` locally; MP's `showLevelUpChoices(choices)` receives server-authored choices. The overlay layout is shared (via `levelUpCard.js`), but the decision source is authoritative-vs-local.
- **WebSocket plumbing** (`connectWS`, `sendInput`, reconnect handling, `joinGame`, `respawnGame`). MP-only. No SP equivalent.
- **MP lobby / map voting / respawn weapon select**. MP-only flow.
- **Prestige shop / start-screen map picker / cosmetic equip**. SP-only flow (MP gets map via vote, not menu pick).
- **Minimap / kill feed / scoreboard / spectator overlay**. MP-only HUD surfaces.

## Surgically duplicated (extract to shared/)

These are the ones worth collapsing — same shape in both, small variation on parameter shape at most.

| Surface | Current SP loc | Current MP loc | Variation | Extract target |
|---|---|---|---|---|
| `setBgmVol` / `setSfxVol` / `toggleVolPanel` / mute button wiring | `main.js:120–168` | `mp-main.js:293–325` | button ID names | `shared/volPanel.js` |
| `selectWeapon(type)` + keyboard 1–4 binding | `main.js:212` | `mp-main.js:442` | SP mutates local `selectedWeapon`, MP emits to socket | `shared/weaponPicker.js` with a callback |
| `resize()` + resize event | `main.js:170–174` | `mp-main.js:333–337` | identical | `shared/viewport.js::bindResize` |
| `joyEnd(e)` + touch joystick state | `main.js:1024` | `mp-main.js:1412` | threshold param (already reconciled) | `shared/joystick.js` (calne already mentioned as P1 follow-up) |
| Music orchestration (menu + battle players, crossfade, mute) | `main.js:144–168` | `mp-main.js:320–331` | SP has 2 players (menu + battle); MP has 1 (battle only) | `shared/musicDirector.js` with `{ hasMenu: boolean }` opt |

Each of these is a straightforward drop-in shared module following the existing decorator pattern. None of them require the unified entry — they're the "extract everything extractable before unifying" pre-work.

## Proposed unified entry

```js
// src/entry.js  — new, replaces main.js and mp-main.js as the root
import { bootSharedServices } from './shared/boot.js';
import { bootSPGame } from './shared/sp-game.js';
import { bootMPGame } from './shared/mp-game.js';

export function bootstrap({ isMP }) {
  bootSharedServices({ isMP });
  if (isMP) return bootMPGame();
  return bootSPGame();
}

// src/main.js becomes:
import { bootstrap } from './entry.js';
bootstrap({ isMP: false });

// src/mp-main.js becomes:
import { bootstrap } from './entry.js';
bootstrap({ isMP: true });
```

`bootSharedServices` wires the things both modes need regardless: viewport resize, vol panel, mute button, keyboard binding, joystick, achievement toast surface. `bootSPGame` owns the SP game loop (init `g`, `update(dt)`, `render()`, `gameLoop(ts)`). `bootMPGame` owns the MP loop (WebSocket, snapshot consumer, lobby, `mainLoop(ts)`).

The `{ isMP }` flag is checked once in `bootstrap()`, not threaded through every function. Shared services that need per-mode variation read the flag from their own module-scope `let isMPMode` set by `bootSharedServices`. This keeps per-call-site branching to near-zero.

### Why not a single game loop

Tempting to collapse `gameLoop(ts)` (SP) and `mainLoop(ts)` (MP) into one ticked function that branches on `isMP`. Don't. Their contents are different enough (SP: tick sim, drain events, render; MP: lerp prev→current snapshot, render) that an `if (isMP)` split inside the loop becomes bigger than just keeping them separate. Keep them as `bootSPGame` and `bootMPGame`'s own internals.

## Migration order

Each step leaves both runtimes bootable. Land as separate PRs, smallest blast-radius first.

1. **Extract the 5 remaining shared surfaces** (vol panel, resize binder, weapon picker, joystick, music director). Each is a small drop-in PR — no bootstrap changes, both entries still boot themselves. Calne has music in flight and joystick on the P1 list; vol panel + resize + weapon picker are likely-fast extractions.
2. **Introduce `src/entry.js` + `shared/boot.js`** as a pure wrapper that currently re-exports the existing `main.js` / `mp-main.js` init work verbatim via `bootSPGame()` / `bootMPGame()`. No behavior change — just the scaffolding in place.
3. **Move SP-specific init into `bootSPGame`**: start screen, prestige shop binding, map picker, `initGame`, `gameLoop`, `update`. At this point `main.js` shrinks to `bootstrap({isMP:false})`.
4. **Move MP-specific init into `bootMPGame`**: WebSocket connect, lobby render, snapshot consumer, `mainLoop`. `mp-main.js` shrinks to `bootstrap({isMP:true})`.
5. **Delete the now-empty original files** or leave them as single-line import stubs if any external reference (HTML `<script>` tag) needs the filename. Template already points at `bundle.js` / `bundle-mp.js` via `scripts/render-html.cjs`, so the build targets can be trivially renamed when convenient.

## Non-goals

- **Do not unify `server.mjs`.** Different runtime (Node), authoritative sim, non-negotiable.
- **Do not try to collapse `update(dt)` with the MP snapshot consumer.** Kept separate in step 3 vs 4 for a reason.
- **Do not delete SP-only or MP-only features to force unification.** Prestige shop, achievements, run history, start-screen map picker stay SP. Lobby, scoreboard, kill feed, spectator overlay stay MP.
- **Do not change bundle output targets** in this pass. `bundle.js` + `bundle-mp.js` stay as separate bundler entry points — each imports `entry.js` but with a different flag. Bundle md5 verification (used in deploy checks) continues to work.

## Open questions

- **Shared state for mute / volume.** SP persists `audio_muted` + `bgm_vol` / `sfx_vol` to localStorage. MP reads the same keys. After `shared/volPanel.js` extraction, which side owns the write? Cleanest: shared module owns both read + write, both modes subscribe.
- **Keyboard binding ordering.** SP binds number keys to level-up choice + weapon picker; MP binds number keys to level-up choice + respawn weapon picker. Both need the same `1/2/3` handler for level-up but divergent `1/2/3/4` for weapon picking. Resolved by `shared/weaponPicker.js` taking a callback that routes to the right mode.
- **Test coverage for the migration.** The sim tests are mode-agnostic (pure sim via `tick.js`). The bootstrap changes are DOM-adjacent and not unit-testable without a DOM harness. Plan: step-by-step PR with manual SP + MP smoke (load the page, weapon-pick, death, respawn, menu music, battle music) between each step.

## Estimated scope

- **Pre-work extraction PRs**: 4–5 PRs, ~100–200 LOC removed each. Low-risk drop-in.
- **Bootstrap PRs (steps 2–5)**: 2–3 PRs. Step 2 is no-behavior-change scaffolding. Step 3+4 are the meaty ones; step 5 is cleanup.
- **Total net**: ~300–500 LOC removed from `main.js` / `mp-main.js` after music + joystick + vol panel + weapon picker + resize + bootstrap scaffolding. Not counting the files that disappear entirely (step 5).

Ready to start at step 1 once music + joystick land.
