# Changelog

## 2026-04-15

### PRs #88–98 (session: seb lead, tiny, calne, barnaldo)

- **#88** — Meteor pid fix (kill credit routing in MP)
- **#89** — View.js typedef refresh (tiny)
- **#90** — Death screen via events, drop processStateChanges (tiny)
- **#91** — Minimap enemy threat tiers: boss halo, elite/brute/spawner colored dots (tiny)
- **#92** — Enemy ranged telegraph windup: aim line + energy motes, dodge window (tiny)
- **#93** — Gem tier visuals: boss/elite drops read distinct on minimap + field (tiny)
- **#94** — Pierce bug fix: per-enemy hit tracking via Set, not per-frame burn (tiny)
- **#95** — Shared SFX module: MP gained 7 missing sound effects, -412 lines (tiny)
  - Also merged: Boss phase transitions — 3 phases, homing shots, swarm summon (calne)
- **#96** — Shared keyboard input module: KEY_MAP + blur clear deduped, -47 lines (tiny)
- **#97** — Shared BGM module: makeBgmPlayer() factory, last audio dedup, -52 lines (tiny)
- **#98** — Homing projectile tracking ring VFX + MP snapshot flag (tiny)

### PRs #99–101

- **#99** — Status effects follow-up: `statusResist` on boss/elite/spawner, snapshot for MP, sprite tints (burn orange flicker, slow blue glow, freeze frost shell + ice shards) (tiny)
- **#100** — Perf profiling harness: `?perf=1` opt-in, per-phase timing, rolling 10s buckets, console report every 120 frames. Result: 28% frame budget at wave 17 + 250 enemies (tiny)
- **#101** — Cross-pair evolution weapons: Inferno Wheel (breath+orbit) and Tesla Aegis (chain+shield). Both source weapons must be maxed. Each source now has two evolution paths. 57 tests green (tiny)

### Other
- **Status effects engine** (calne): `applyStatus(g, enemy, effect)` with burn (DoT), slow (speed multiplier), freeze (stunTimer). `statusResist` shortens durations on bosses/elites/spawners. Refresh-on-reapply, no stacking.
- **MP spectate** (calne): ID-based tracking, Tab cycling, auto-advance on death, DOM overlay, minimap cyan ring.
- **SFX master gain + concurrency cap**: sfxMaster 0.6×, max 12 concurrent (fixes chain lightning drowning BGM)
- **BGM + SFX volume sliders**: localStorage persistence, mute toggle, ▼ panel
- **57-test sim suite**: waves, enemy scaling, weapon DPS, pierce, enemy projectiles, prestige, RNG determinism, cross-pair evolutions (`npm test`)
- **Weapon card shuffle**: Fisher-Yates on page load — fixes spit default-click bias
- **README.md + CHANGELOG.md**: Project docs for team catch-up

### Analytics highlights
- Wave 23 reached (6,327 kills)
- All 9 starting weapons being picked
- 91%+ game start rate from page loads
- Spit picked 8/8 times (first-card bias) — fixed with shuffle

### Up next
- **Level-up system polish** (calne claiming)
- **Map variety / procedural obstacles** (unclaimed)
- **VFX + netcode + SP-MP parity** (tiny, per vox directive)
