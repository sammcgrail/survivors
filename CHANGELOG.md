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

### PRs #102–107 (session: seb lead, tiny, calne)

- **#102** — Procedural maps: wilderness (cluster-scatter) + catacombs (corridor), `mapGen.js`, `resolveMapObstacles()` helper (tiny)
- **#103** — Weapon balance pass: spit 15→20 dmg, chain 20→28 + cd 0.9 + 3 chains, lightning_field 22 dmg + 4 zaps, inferno_wheel 20→16 blade. New `weapon_bench.mjs` harness (tiny)
- **#104** — Enemy variety: poisoner (contact DoT), splitter (swarmlings on death), bomber (explosion on death), healer (AoE pulse). Declarative `splitOn`/`explodeOn` config, `playerStatus.js` DoT system (tiny)
- **#105** — Boss phase 4: 25% HP enrage, summon 2 healers, faster shooting, compressed charge without telegraph, `phase >= 3` homing fix (tiny)
- **#106** — Phase 4 VFX: crimson particle burst, white sparks, "ENRAGED" banner, screen shake + flash, minimap border pulse (tiny)
- **#107** — Spawner poisoner broods: wave 12+ spawners roll ~33% poisoner minions (tiny)

### Calne fork PRs #5–11

- **fork #5** — Level-up card polish: evo gold border, `✦ EVOLUTION` badge, stat delta strings on all 17 upgrades (calne)
- **fork #6** — MP parity fix: weapon icons, wave counter `/20`, boss warning (calne)
- **fork #7** — Kill feed (top-left) + scoreboard (above minimap) for MP (calne)
- **fork #8** — Achievement system: 10 milestones, localStorage-backed, toast notifications, death screen badge row (calne)
- **fork #9** — MP lobby: server-side queue, 10s countdown, map vote with majority tally, late-join skip (calne)
- **fork #10** — MP achievement badges: read-only localStorage badges on MP death screen (calne)
- **fork #11** — Run history: last 5 runs on death screen (wave, kills, time survived), localStorage persistence (calne)

### Other (session 2)
- **68-test sim suite**: +11 tests (poisoner contact, splitter death, bomber blast, healer pulse, spawner poisoner broods wave 12+/pre-12, boss phase 4 transition, phase 4 homing, procedural map determinism)
- **Weapon bench**: `tests/weapon_bench.mjs` — 14 weapons × 5 waves × 30s DPS, `--weapon`/`--wave`/`--csv` flags
- **Inferno Wheel tops DPS chart**: 4800 DPS at wave 18, followed by fortress (3977) and tesla_aegis (4457)

### Up next
- **Map variety polish / more procedural modes** (unclaimed)
- **VFX + netcode + SP-MP parity** (tiny, per vox directive)
- **Barn deliverables** (absent all session)

## 2026-04-16

### PRs #114–117 (session: seb lead, tiny / calne fork #15)

- **#114** — XP falloff fix: gem tier system + flattened level curve. `GEM_MULTIPLIER` {boss:25, brute:5, elite:3, spawner:3}, `GEM_TIER` {boss:3, brute:2, elite:1, spawner:1}. Tier visuals: common blue, elite green, brute orange (not blue — avoids minimap gem-color clash), boss purple. xpToLevel cascade 1.30 → 1.22 in `src/main.js` + `server.mjs` + prestige path. 70 tests green. Resolves barnaldo's W35 falloff complaint (tiny)
- **#115** — VFX pass 2 round 1: tiered death bursts (boss 2-stage implosion, brute chunky shards, elite violet soul-wisp, swarm quick puff), healer pulse ring telegraph. 72 tests green. Rebased onto #114 cleanly (tiny)
- **#116** — VFX pass 2 round 2: overkill punch-frame (dual gate — 3× pre-hit HP AND [≥50 dmg OR threat-tier]) to stop spit-one-shotting blobs triggering it. Spit core brightness tier, chain lightning afterimage at density (~27 strokes/frame worst case, well under perf cap). 75 tests green (tiny)
- **#117** — Map ambient pass: `src/shared/mapAmbient.js` dispatcher, per-map identity generators — arena warm embers · forest/wilderness fireflies · ruins/catacombs torch flicker + dust · neon glitch flecks · graveyard cold mist wisps. Budget ~30–90 particles/sec/map, steady-state cap ~80. Redirected from VFX pass 2 item #4 (was global dust motes) for 4× payoff (tiny, per seb steer)
- **calne fork #15** — Boss phase 5 final form (25% → 10% HP gate): teleport bursts, minion rain, arena nova, resurrection mechanic with "RESURRECTED" banner. Cherry-picked from agent-entro/survivors fork into main (calne)

### Deploy split gotcha (saved to memory)
- `survivors.sebland.com` is **CF Pages** (CNAME → `survivors-sp.pages.dev`), needs `npx wrangler pages deploy --project-name=survivors-sp --branch=main --commit-dirty=true`
- `mpsurvivors.sebland.com` is **Caddy** from `/srv/mpsurvivors` via box-web Docker — `docker compose build --no-cache web && up -d web`
- Rebuilding box-web for SP deploys is a no-op. Wasted ~20min debugging stale bundle before DNS lookup caught the CNAME

