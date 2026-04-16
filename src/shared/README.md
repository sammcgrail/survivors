# `src/shared/` — Shared-code inventory + drift contracts

Everything here is reachable from more than one entry point. This doc
is a living reference for reviewers: when a PR changes a file here,
check the **"used by"** column and make sure every consumer still works.

## Entry points

| File | Runs in | What it is |
|---|---|---|
| `src/main.js` | SP browser client | Runs the sim locally + renders |
| `src/mp-main.js` | MP browser client | Consumes snapshots + renders; **does not** run sim |
| `server.mjs` | Node MP server | Authoritative sim at 20Hz, broadcasts state |

When people talk about "sim code" they mean the graph rooted at
`tick.js`. SP runs it inline each frame; the server runs it on its own
schedule; the MP client is a pure read-only renderer.

## `sim/*` — pure simulation (no DOM, no canvas, no Date)

Pure modules that run on **both SP and server**. Must stay pure so
server/client determinism holds.

Invariants (broken = silent desync):

- No `document`, `window`, `canvas`, `Image`, `performance.now()`, `Date.now()` etc.
- No module-scoped mutable state — per-player state lives on the player
  object (e.g. `p.powerupStacks`), per-game state on `g`. MP has many
  players sharing one sim; globals break it.
- All randomness through `g.rng` (a seeded RNG). Server seeds it,
  clients follow by replay.
- Events go into `g.events` via `emit(g, EVT.X, payload)`. Clients drain
  `g.events` for sfx/particles/floating text — sim logic never reads
  its own events back.

Module list (entry points import via `import { ... } from './shared/sim/...'`):

| File | Role |
|---|---|
| `tick.js` | Top-level sim loop — orchestrates all updates per frame |
| `rng.js` | Seeded RNG (must be deterministic across node/browser) |
| `events.js` | `EVT` enum + `emit(g, type, payload)` |
| `powerups.js` | `POWERUPS` catalog + `getAvailableChoices(stacks)` |
| `weapons_runtime.js` | Per-weapon fire + tick logic |
| `damage.js` | `damageEnemy` + on-kill hooks (gems, hearts, split, explode) |
| `projectiles.js` | Bullet motion + hit resolution |
| `enemies.js` | Movement + flock steering + repulsion + boss AI |
| `enemyProjectiles.js` | Enemy shooting AI |
| `collision.js` | Spatial hash + hit-test sweeps (bullet↔enemy, enemy↔player) |
| `gems.js` | Gem drops + magnet pull |
| `hearts.js` | Heart pickup + heal |
| `consumables.js` | Bomb / magnet / etc. drops + pickup |
| `playerStatus.js` | Slow / burn / stun accumulators on players |
| `waves.js` | Wave spawn pacing + special waves |
| `terrain.js` | Obstacle collision integration |

## Non-sim shared/ — client-facing (usually DOM or audio)

Used by SP + MP clients. **Must not be imported by `sim/*`** (would
break server purity) or by `server.mjs`.

| File | Role | SP | MP |
|---|---|---|---|
| `render.js` | Canvas2D draw: projectiles, particles, effects, player | ✓ | ✓ |
| `obstacleSprites.js` | Obstacle art + neon bg renderer | ✓ | ✓ |
| `tileBackground.js` | Pre-rasterized tile background canvas | ✓ | ✓ |
| `simEventHandler.js` | Drains sim events → sfx / particles / shake | ✓ | ✓ |
| `levelUpCard.js` | Level-up card decoration (role chip, evo icons) | ✓ | ✓ |
| `mapAmbient.js` | Per-map decorative particle generators | ✓ | ✓ |
| `input.js` | Keyboard + touch input capture | ✓ | ✓ |
| `sfx.js` | WebAudio SFX trigger | ✓ | ✓ |
| `bgm.js` | Background music player | ✓ | ✓ |
| `view.js` | View-shape contract; `synthesizeView` adapts SP's `g` into the MP-snapshot shape | ✓ | ✗ |
| `runHistory.js` | Local-storage run log (SP only, no remote persistence) | ✓ | ✗ |
| `htmlEscape.js` | `escapeHTML` | ✓ | ✓ |

Note: `view.js` defines a shape both runtimes rely on — but only SP
*imports* it (to adapt its in-process `g` into snapshot shape). MP
receives that shape natively from the server. `runHistory.js` is the
other intentional exception, SP-only because it writes to local
storage.

## Data catalogs — used by everyone (SP, MP, server)

Single source of truth. Any change here must work identically across
all three runtimes.

| File | Role | SP | MP | Server |
|---|---|---|---|---|
| `constants.js` | `WORLD_W/H`, `PLAYER_RADIUS`, etc. | ✓ | ✓ | ✓ |
| `weapons.js` | `createWeapon` + `WEAPON_ICONS` + preview meta | ✓ | ✓ | ✓ |
| `maps.js` | `MAPS` catalog + obstacle resolver | ✓ | ✓ | ✓ |
| `enemyTypes.js` | `ENEMY_TYPES` + `scaleEnemy` + wave pools | (transitive) | (transitive) | (transitive) |
| `prestige.js` | Unlocks + scale calculation | ✓ | ✓ | ✓ |
| `achievements.js` | `UNLOCKS` list (cosmetic only) | ✓ | ✓ | ✗ |
| `bestiary.js` | Enemy display flavor text | ✓ | ✓ | ✗ |
| `mapGen.js`, `mapTerrain.js`, `sprites.js` | Imported by `maps.js` / `render.js` — no direct entry-point use | (transitive) | (transitive) | (transitive) |

## Anti-drift checklist (for reviewers)

When touching these files, check that the contract isn't subtly broken
in one runtime:

1. **`weapons.js` / `createWeapon()`** — SP, MP client, and server all
   call this. A new stat field must be consumed by both `weapons_runtime.js`
   (sim side) AND `render.js` (draw side). MP client builds the `w`
   object from server snapshots; `snapshotWeapon` in `server.mjs` must
   include the new field.
2. **`sim/powerups.js` / `POWERUPS`** — server serializes `id / name /
   desc / icon / stats / requiresEvo` to MP clients. New fields need
   to either be in the serialized set or be deriveable client-side
   from the id (see `powerupWeaponType` + `getWeaponPreview` as the
   pattern).
3. **`sim/events.js` / `EVT`** — every new event needs a handler
   branch in `simEventHandler.js`. Missing handlers silently drop the
   event in one runtime.
4. **`simEventHandler.js`** — SP drains `g.events` directly, MP drains
   `state.events` from each snapshot. Both hit the same switch. Do
   not add SP-only or MP-only branches without explicit `client.isMe`
   gating.
5. **`levelUpCard.js`** — SP `showLevelUp` + MP `showLevelUpChoices`
   both call `decorateWeaponCard(div, choice)`. Adding card fields
   belongs in this helper, not inlined in either caller.
6. **`sim/*` purity** — any new sim file must not `import` from
   `render.js`, `sfx.js`, `input.js`, or any browser globals. The
   server will crash on the first `document` reference.

## Common drift traps (historical)

- **Hardcoded constants in MP that exist in SP via `constants.js`** —
  e.g. `playerRadius = 14` in `mp-main.js` instead of `PLAYER_RADIUS`
  import. Landed in `abefdaa`.
- **`makePlayer()` init missing stats** — SP sets `projectileBonus:0`,
  `sizeMulti:1`, `armor:0`; MP server forgot these, so Barrage /
  Amplify / Iron Skin silently no-op'd in MP. Always grep for every
  field a powerup mutates and ensure both runtimes init them. Landed in
  `abefdaa`.
- **Map rotation vs catalog** — a new map in `MAPS` is only playable
  in MP if it's also in `MAP_ROTATION` + `MAP_VOTE_EMOJIS` in
  `server.mjs`. Neon slipped through; fixed in `1988dfa`.
- **Fork main vs `sammcgrail/main`** — fork audits must diff against
  `sammcgrail/main`, not the fork's own `main`, or findings can be
  "stale PRs catching up to main" rather than real drift.
