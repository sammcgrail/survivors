# Survivors

Top-down browser survival game. Dodge enemies, collect XP, level up weapons, survive as long as you can.

**Play now:**
- Single-player: [survivors.sebland.com](https://survivors.sebland.com)
- Multiplayer: [mpsurvivors.sebland.com](https://mpsurvivors.sebland.com)

## Architecture

```
src/
├── main.js              # SP entry point (canvas, game loop, UI)
├── mp-main.js           # MP client entry point (WebSocket, server-driven)
└── shared/
    ├── constants.js     # World size, player stats
    ├── weapons.js       # Weapon definitions (12 types)
    ├── enemyTypes.js    # Enemy types, wave pools, special waves
    ├── prestige.js      # Dragon Scales meta-progression
    ├── render.js        # Canvas rendering (enemies, projectiles, VFX)
    ├── view.js          # View state typedef + synthesis
    ├── simEventHandler.js # Client-side VFX/SFX from sim events
    ├── sfx.js           # Shared SFX oscillator synthesis
    ├── bgm.js           # Shared BGM player factory
    ├── input.js         # Shared keyboard input (KEY_MAP + blur clear)
    ├── maps.js          # Obstacle/terrain definitions
    └── sim/
        ├── tick.js      # Master tick (calls all subsystems in order)
        ├── waves.js     # Wave progression + spawn scheduling
        ├── enemies.js   # Enemy AI (flock, ghost orbit, boss charge, spawner)
        ├── enemyProjectiles.js  # Enemy ranged attacks (aim/fire/homing)
        ├── projectiles.js       # Player projectile movement + collision
        ├── weapons_runtime.js   # Per-tick weapon fire + aura logic
        ├── damage.js    # Damage application, gem/heart drops
        ├── gems.js      # XP gem pickup + magnet
        ├── hearts.js    # Heart drop healing
        ├── consumables.js # Bomb/shield/magnet pickups
        ├── collision.js # Circle-rect + obstacle avoidance
        ├── terrain.js   # Terrain slow/DoT effects
        ├── powerups.js  # Level-up choices
        ├── events.js    # Event types + emit()
        └── rng.js       # Seeded deterministic RNG

server.mjs               # MP authoritative server (WebSocket, 30Hz tick)
template.html             # Shared HTML template → sp.html + mp.html
bundle.js / bundle-mp.js # Built bundles (esbuild)

tests/
├── sim_smoke.mjs    # Quick 10s headless sim (npm run smoke)
├── sim_tests.mjs    # 52-test suite: waves, DPS, prestige, projectiles (npm test)
├── server_smoke.mjs # MP server WebSocket smoke test
├── regression.mjs   # Playwright SP+MP page load regression
└── stress.mjs       # Performance stress scenarios (Playwright)
```

## Commands

```bash
npm run build       # esbuild SP + MP bundles
npm run smoke       # Quick sim smoke test (10s, ~20ms)
npm test            # Full 52-test suite
npm run mp-server   # Start MP server on :7700
npm run mp-smoke    # MP server WebSocket smoke test
npm run regression  # Playwright SP+MP regression (needs chromium)
npm run stress      # Performance stress scenarios
```

## Weapons (12)

| Weapon | Type | Base DPS | Notes |
|--------|------|----------|-------|
| Spit | Projectile | 18.75 | Auto-aim nearest, pierce upgrade |
| Breath | AoE pulse | 16 | Short-range continuous |
| Charge | Dash | 22.2 | Burst damage + trail |
| Orbit | Blades | Continuous | 2 spinning blades |
| Chain | Bounce | 16.7 | Bounces to 2 targets |
| Meteor | Impact | 14.3 | Highest single-hit (50), AoE blast |
| Lightning Field | Zone | 30 | 3 zaps in radius per fire |
| Shield | Barrier | Continuous | Knockback aura |
| Dragon Storm | Evolution | Spit++ | 3-shot, pierce 3, fire aura |
| Thunder God | Evolution | Chain++ | 5-chain + permanent field |
| Meteor Orbit | Evolution | Meteor++ | 4 flame blades + mini-meteors |
| Fortress | Evolution | Shield++ | Barrier + charge + shockwave |

## Enemies (9 types)

**Regular:** blob, fast, swarm, tank, ghost (wall-phase + orbit AI)
**Special:** brute (high HP charger), spawner (births swarm minions), elite (ranged, purple bolts), boss (3-phase fight)

### Boss Phases
- **Phase 1** (100-67% HP): 3-shot spread, normal speed
- **Phase 2** (67-33% HP): 5-shot tighter spread, speed ×1.30, orange flash
- **Phase 3** (<33% HP): 3 homing projectiles (1.5 rad/s turn), speed ×1.56, summons 3 swarm minions every 8s

## Wave System

- 20 waves, 20s each. Spawn rate decays from 2.0s to 0.3s floor.
- Special waves: Swarm Rush (6), Phantom (7), Tank Parade (9), Ghost Storm (11), Brute Force (13), The Horde (15), Elite Guard (17), Hive Mind (19), The Demon (20, boss).
- Enemy scaling: HP ×(1 + 0.12/wave + 0.04 late), speed ×(1 + 0.03/wave), damage ×(1 + 0.1/wave).

## Prestige (Dragon Scales)

Meta-progression earned on death: `floor(wave/2) + floor(kills/50) + evolutions`.

Unlocks: Tough Scales (+10 HP ×5), Swift Wings (+5% speed ×3), Keen Eyes (+10% magnet ×3), Thick Hide (+0.5 regen ×3), Fury (+5% damage ×5), Extra Heart (+25 HP), Headstart (level 2), Gold Dragon skin, Shadow Dragon skin, Fire Trail.

## Deploy

```bash
# SP → Cloudflare Pages
npx wrangler pages deploy . --project-name=survivors-sp --commit-dirty=true

# MP → systemd
sudo systemctl restart survivors-server.service

# Purge CF cache after both
source /root/seb/.env && curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```
