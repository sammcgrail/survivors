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

### Other
- **SFX master gain + concurrency cap**: sfxMaster 0.6×, max 12 concurrent (fixes chain lightning drowning BGM)
- **BGM + SFX volume sliders**: localStorage persistence, mute toggle, ▼ panel
- **52-test sim suite**: waves, enemy scaling, weapon DPS, pierce, enemy projectiles, prestige, RNG determinism (`npm test`)
- **README.md + CHANGELOG.md**: Project docs for team catch-up

### Analytics highlights
- Wave 23 reached (6,327 kills)
- All 9 starting weapons being picked
- 91%+ game start rate from page loads

### In progress
- **Status effects** (tiny): burn/slow/freeze on weapons. `e.statuses` dict, `statusResist` on boss/elite.
- **Task assignment**: calne picking from perf pass / MP spectate / status effects tick system
