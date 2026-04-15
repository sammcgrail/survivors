# Survivors — Feature Specs

Four features in priority order. Each spec references actual file paths, function names, and line ranges from the current codebase.

---

## Feature 1: MP/SP Parity Fixes

### Overview

The MP client (`src/mp-main.js`) is a thin display layer that renders server snapshots. It is missing several gameplay features that SP (`src/main.js`) has. This spec identifies every gap and details how to close each one.

### Gap Analysis

| Feature | SP has it? | MP has it? | Root cause |
|---------|-----------|-----------|------------|
| Heart drops (render + pickup) | Yes (main.js:927-946 render, 523-551 pickup) | **No** | Server doesn't broadcast `heartDrops`; MP client has no render code |
| XP bar | Yes (template.html:77-78, main.js:583-587) | **No** | Template has `#xp-bar` but MP never updates `#xp-fill` — server snapshot doesn't include per-player `xp` or `xpToLevel` |
| Level-up choices | Yes (main.js:688-736, powerups.js) | **No** | Server drops `g.events` every tick (server.mjs:130) — LEVEL_UP events never reach clients. No choice generation or selection protocol exists. |
| Wave banners | Yes (main.js:1338-1366, canvas-rendered) | **No** | Server broadcasts `wave` number but not `waveMsg`/`waveMsgTimer`/`specialWaveMsg`/`specialWaveMsgTimer` |
| Death feed | Yes (main.js:1369-1384, canvas-rendered) | **No** | Server has `g.deathFeed` array but doesn't include it in `gameSnapshot()` |
| Floating damage numbers | Yes (main.js:621-628 via events) | **No** | Events dropped server-side |
| Heart pickup sound + floating text | Yes (main.js:541-549) | **No** | Hearts not in MP at all |
| Charge weapon visual | Yes (main.js:1203-1255) | **Partial** | MP renders weapon type name only, no charge trail |
| Level-flash overlay | Yes (main.js:614) | **No** | No level-up event flow |
| Best run / leaderboard | Yes (main.js:738-863) | **No** | MP death screen is bare (mp-main.js:398-409) |

### Data Structures

**Server snapshot additions** (in `gameSnapshot()`, server.mjs:138-173):

```js
// Add to the snapshot object:
heartDrops: game.heartDrops.map(h => ({
  x: r1(h.x), y: r1(h.y), heal: h.heal, radius: h.radius,
  life: r2(h.life), bobPhase: r2(h.bobPhase),
})),
deathFeed: game.deathFeed.slice(-5).map(d => ({
  text: d.text, time: r1(d.time),
})),
waveMsg: game.waveMsgTimer > 0 ? game.waveMsg : null,
waveMsgTimer: r2(game.waveMsgTimer),
specialWaveMsg: game.specialWaveMsgTimer > 0 ? game.specialWaveMsg : null,
specialWaveMsgTimer: r2(game.specialWaveMsgTimer),
```

**Per-player additions** (in the `players` map inside `gameSnapshot()`):

```js
// Add to each player entry:
xp: p.xp,
xpToLevel: p.xpToLevel,
```

**New server message types for level-up flow:**

```js
// Server -> specific client
{ type: 'levelup', choices: [{ id, name, desc, icon }, ...] }

// Client -> server
{ type: 'choose', choiceId: 'speed' }
```

### Level-Up Choice System (hardest part)

This is the most complex change. Currently in SP, level-up pauses the game and the client picks from `POWERUPS` directly (main.js:688-736). In MP, the game can't pause — instead:

**Server-side changes (server.mjs):**

1. Import `POWERUPS` from `src/shared/sim/powerups.js`
2. Stop discarding `g.events` blindly. After `tickSim()`, scan for `LEVEL_UP` events:

```js
// In tick(), after tickSim(game, dt):
for (const evt of game.events) {
  if (evt.type === 'levelUp') {
    const player = game.players.find(p => p.id === evt.pid);
    if (!player) continue;
    const choices = generateChoices(player);
    player.pendingChoices = choices;
    player.choiceTimeout = 10; // 10 second timeout
    // Find the websocket for this player
    for (const [ws, p] of players) {
      if (p.id === evt.pid) {
        ws.send(JSON.stringify({
          type: 'levelup',
          choices: choices.map(c => ({ id: c.id, name: c.name, desc: c.desc, icon: c.icon })),
        }));
        break;
      }
    }
  }
}
game.events.length = 0;
```

3. Add `generateChoices(player)` function — mirrors SP logic but tracks stacks per-player:

```js
function generateChoices(player) {
  // Player needs per-player powerup stacks tracked on the player object.
  // player.powerupStacks = { speed: 0, damage: 0, weapon_spit: 1, ... }
  const available = POWERUPS.filter(p => {
    const stack = player.powerupStacks[p.id] || 0;
    if (stack >= p.max) return false;
    if (p.hidden) return false; // Note: hidden getter uses global stacks — needs fix, see below
    if (p.requires) {
      const reqStack = player.powerupStacks[p.requires] || 0;
      if (reqStack === 0) return false;
    }
    return true;
  });
  // Shuffle and pick 3
  for (let i = available.length - 1; i > 0; i--) {
    const j = game.rng.int(i + 1);
    [available[i], available[j]] = [available[j], available[i]];
  }
  return available.slice(0, 3);
}
```

4. Handle `choose` message (add to ws.onmessage handler, server.mjs:199):

```js
if (msg.type === 'choose') {
  if (!player.pendingChoices) return;
  const choice = player.pendingChoices.find(c => c.id === msg.choiceId);
  if (!choice) return;
  player.powerupStacks[choice.id] = (player.powerupStacks[choice.id] || 0) + 1;
  choice.apply(game, player);
  player.pendingChoices = null;
}
```

5. Add `powerupStacks` to `makePlayer()` (server.mjs:42):

```js
powerupStacks: { ['weapon_' + weaponType]: 1 },
```

**Critical fix for evolution detection:** The `evo_dragon_storm` entry in powerups.js (line 37-39) uses a global `hidden` getter that reads from the module-level `POWERUPS` array's `.stack` field. This is single-player only. For MP, `generateChoices` must check per-player stacks instead:

```js
// In generateChoices, special-case evolution check:
if (p.id === 'evo_dragon_storm') {
  const spitStack = player.powerupStacks['spit_up'] || 0;
  const breathStack = player.powerupStacks['breath_up'] || 0;
  if (spitStack < 3 || breathStack < 3) return false;
}
```

**Client-side changes (mp-main.js):**

1. Add `ws.onmessage` handler for `type: 'levelup'` — show the `#level-up` overlay with choices
2. On click/tap of a choice, send `{ type: 'choose', choiceId }` to server
3. Add timeout — if player doesn't choose in 10s, auto-pick first option (client-side timer sends choose)
4. Game does NOT pause for other players — only the choosing player sees the overlay

### Files to Modify

| File | Changes |
|------|---------|
| `server.mjs` | Add heartDrops/deathFeed/waveMsg/xp to snapshot (gameSnapshot ~line 138). Add powerupStacks to makePlayer (~line 42). Scan events for LEVEL_UP before clearing (~line 130). Handle `choose` message type (~line 233). Import POWERUPS. |
| `src/mp-main.js` | Render heart drops (new section after gems ~line 614). Update XP bar from per-player xp/xpToLevel (~line 901). Render wave banners (new section in render() ~line 897). Render death feed (new section). Handle `levelup` WS message (new in onmessage ~line 269). Show level-up UI with choice cards. Send `choose` message back. |
| `template.html` | Remove `class="sp-only"` from `#level-up` div (line 174). Remove `class="sp-only"` from death screen sub-elements that should be shared. |
| `src/shared/sim/powerups.js` | Export a `getAvailableChoices(powerupStacks)` helper that works with per-player stacks (not module-global stacks). Keep existing SP flow working. |

### Implementation Steps

1. **Server snapshot expansion** — Add heartDrops, deathFeed, waveMsg/specialWaveMsg, per-player xp/xpToLevel to `gameSnapshot()`. Easiest change, no protocol changes.
2. **MP client rendering** — Add heart drop rendering, wave banners, death feed, XP bar update. Pure client-side, no server changes needed beyond step 1.
3. **Per-player powerup tracking** — Add `powerupStacks` to player objects, refactor `POWERUPS` hidden/requires checks to accept external stack map.
4. **Level-up protocol** — Server event scanning, choice generation, `levelup`/`choose` message flow.
5. **MP level-up UI** — Client overlay, choice rendering, timeout auto-pick.

### Estimated Complexity

**Medium-high.** Steps 1-2 are straightforward (3-4 hours). The level-up protocol (steps 3-5) is the bulk of the work — refactoring powerup stacks from global to per-player, building the request/response flow, and handling edge cases (disconnect during choice, timeout, rapid multi-level) will take 6-8 hours. Total: ~10-12 hours.

---

## Feature 2: Maps System

### Overview

Add multiple arenas with terrain obstacles. Obstacles block player/enemy movement and (optionally) projectiles. The server selects the map at game start and broadcasts it to clients.

### Data Format

```js
// src/shared/maps.js
export const MAPS = {
  arena: {
    name: 'The Arena',
    width: 3000,
    height: 3000,
    obstacles: [],  // open field, current behavior
  },
  ruins: {
    name: 'Ancient Ruins',
    width: 3000,
    height: 3000,
    obstacles: [
      // Axis-aligned rectangles (cheapest collision)
      { x: 800, y: 800, w: 200, h: 40, type: 'wall' },
      { x: 1400, y: 1200, w: 40, h: 300, type: 'wall' },
      { x: 2000, y: 600, w: 150, h: 150, type: 'pillar' },
      // ... 15-25 obstacles per map
    ],
    spawns: [  // valid player spawn zones (avoid spawning inside walls)
      { x: 1500, y: 1500, radius: 200 },
    ],
  },
  forest: {
    name: 'Dark Forest',
    width: 4000,
    height: 4000,  // bigger map
    obstacles: [
      { x: 500, y: 500, w: 60, h: 60, type: 'tree' },
      // ... scattered trees, denser at edges
    ],
    spawns: [{ x: 2000, y: 2000, radius: 300 }],
  },
};
```

**Obstacle types:**
- `wall` — blocks movement AND projectiles. Opaque rendering.
- `pillar` — blocks movement AND projectiles. Circular collision (store `r` instead of `w/h`).
- `tree` — blocks movement only. Projectiles pass through. Semi-transparent rendering.

### Collision System

**AABB collision for rectangular obstacles** — cheapest and good enough for axis-aligned walls:

```js
// src/shared/sim/collision.js
export function circleRectCollision(cx, cy, cr, rx, ry, rw, rh) {
  const nearestX = Math.max(rx, Math.min(cx, rx + rw));
  const nearestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx * dx + dy * dy) < (cr * cr);
}

export function resolveCircleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nearestX = Math.max(rx, Math.min(cx, rx + rw));
  const nearestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist >= cr || dist < 0.01) return null;
  const push = cr - dist;
  return { x: (dx / dist) * push, y: (dy / dist) * push };
}
```

### Sim Integration

Obstacles affect these systems:

**1. Player movement (server.mjs:100-112, main.js:505-508):**
After applying input velocity, check collision with every obstacle. If colliding, push the player out. Store obstacles on `g.obstacles` so the same code works in SP and MP.

```js
// In applyInputs (server.mjs) and update (main.js), after position update:
for (const obs of g.obstacles) {
  const push = resolveCircleRect(p.x, p.y, p.radius, obs.x, obs.y, obs.w, obs.h);
  if (push) { p.x += push.x; p.y += push.y; }
}
```

**2. Enemy movement (enemies.js:122-129):**
Same treatment — after each enemy moves toward its target, resolve collisions with obstacles. This naturally creates "pathfinding" as enemies slide along walls.

```js
// In updateEnemyTick, after movement block (~line 128):
for (const obs of g.obstacles) {
  const push = resolveCircleRect(e.x, e.y, e.radius, obs.x, obs.y, obs.w, obs.h);
  if (push) { e.x += push.x; e.y += push.y; }
}
```

**3. Projectile blocking (projectiles.js:9-10):**
After moving a projectile, check if it intersects any `wall` or `pillar` obstacle (not `tree`). If so, destroy it.

```js
// In updateProjectiles, after position update (~line 10):
for (const obs of g.obstacles) {
  if (obs.type === 'tree') continue; // trees don't block projectiles
  if (circleRectCollision(proj.x, proj.y, proj.radius, obs.x, obs.y, obs.w, obs.h)) {
    g.projectiles.splice(i, 1);
    break;
  }
}
```

**4. Enemy spawning (enemies.js:29-30):**
After clamping spawn position, check if it's inside an obstacle. If so, nudge outward or re-roll.

**5. Gem/heart drops:**
Don't need obstacle collision — they can overlap walls fine (keeps pickup accessible).

### Performance Note

With 15-25 obstacles per map and ~100 enemies, obstacle collision is O(enemies * obstacles) = ~2500 checks/tick. Each check is 6 comparisons + 1 sqrt. Negligible at 20Hz.

For maps with many more obstacles (>50), add a spatial grid bucketing obstacles by cell — same pattern as enemy repulsion in enemies.js:157-196.

### Server Map Selection

```js
// In initGame() (server.mjs:70):
const mapId = 'ruins'; // or random, or voted
const map = MAPS[mapId];
return {
  ...existingFields,
  mapId,
  obstacles: map.obstacles,
  // Replace WORLD_W/WORLD_H with map dimensions
};
```

Add map info to `welcome` message and `gameSnapshot()`:
```js
// welcome message — send once on join
{ type: 'welcome', ..., map: { id: mapId, obstacles: map.obstacles, w: map.width, h: map.height } }

// gameSnapshot — just the id, client already has obstacle data from welcome
{ ..., mapId: game.mapId }
```

### Client Rendering

Render obstacles between the background grid and gems. Simple filled rectangles with border:

```js
for (const obs of obstacles) {
  if (obs.type === 'wall') {
    ctx.fillStyle = '#1a1a2e';
    ctx.strokeStyle = '#333';
  } else if (obs.type === 'pillar') {
    ctx.fillStyle = '#2a1a1e';
    ctx.strokeStyle = '#533';
  } else if (obs.type === 'tree') {
    ctx.fillStyle = 'rgba(46, 204, 113, 0.3)';
    ctx.strokeStyle = 'rgba(46, 204, 113, 0.5)';
  }
  ctx.lineWidth = 2;
  ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
  ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
}
```

### Files to Modify

| File | Changes |
|------|---------|
| **New: `src/shared/maps.js`** | Map definitions with obstacle arrays |
| **New: `src/shared/sim/collision.js`** | `circleRectCollision`, `resolveCircleRect` |
| `src/shared/sim/tick.js` | Pass `g.obstacles` context (already on `g`, no change needed if stored there) |
| `src/shared/sim/enemies.js` | Import collision. Add obstacle push after movement (~line 128). Obstacle check on spawn (~line 29). |
| `src/shared/sim/projectiles.js` | Import collision. Destroy projectiles hitting wall/pillar obstacles (~line 10). |
| `src/shared/constants.js` | Remove hardcoded WORLD_W/WORLD_H or keep as defaults; maps override. |
| `server.mjs` | Import MAPS. Store obstacles on game state. Send map in welcome. Set dimensions from map. Obstacle collision in `applyInputs` for player. |
| `src/main.js` | Import MAPS. Store obstacles on game state. Collision in player movement. Render obstacles. |
| `src/mp-main.js` | Receive map from welcome. Render obstacles. |

### Implementation Steps

1. Create `maps.js` with 2-3 map definitions + `collision.js` with AABB helpers.
2. Wire obstacles into `g` state in both SP `initGame()` and MP `initGame()`.
3. Add player obstacle collision in `applyInputs` (server) and `update` (SP client).
4. Add enemy obstacle collision in `enemies.js`.
5. Add projectile blocking in `projectiles.js`.
6. Client rendering of obstacles in both SP and MP.
7. Map selection UI (dropdown or vote system for MP, random or select for SP).

### Estimated Complexity

**Medium.** The collision math is standard. The main work is threading `g.obstacles` through every movement system and testing edge cases (enemies stuck in corners, projectiles clipping through thin walls at high speed). 8-10 hours.

---

## Feature 3: Prestige / Unlock System (Dragon Scales)

### Overview

Persistent meta-progression currency called "Dragon Scales" earned per run, spent on permanent unlocks. Stored in localStorage (SP) with optional server sync (MP). Unlocks provide stat bonuses, cosmetic options, and weapon variants.

### Currency: Dragon Scales

**Earn formula (per run):**

```js
function calculateScales(run) {
  // Base: 1 scale per wave survived
  let scales = run.wave;
  // Bonus: 1 scale per 50 kills
  scales += Math.floor(run.kills / 50);
  // Bonus: 1 scale per evolution achieved
  scales += run.evolutions;
  // First clear bonuses (one-time)
  if (run.wave >= 10 && !unlocked('milestone_w10')) scales += 5;
  if (run.wave >= 20 && !unlocked('milestone_w20')) scales += 15;
  // Minimum 1 scale per run (even dying on wave 1)
  return Math.max(1, scales);
}
```

Expected rates:
- Wave 5 death, 30 kills: ~6 scales
- Wave 10 death, 100 kills: ~12 scales (+5 milestone)
- Wave 15 death, 250 kills: ~20 scales
- Wave 20 boss kill: ~30 scales (+15 milestone)

### Unlock Tree

```js
// src/shared/prestige.js
export const UNLOCKS = {
  // --- Stat bonuses (stack) ---
  tough_scales:    { name: 'Tough Scales',    desc: '+10 max HP',           cost: 5,  max: 5, apply: (p) => { p.maxHp += 10; p.hp += 10; } },
  swift_wings:     { name: 'Swift Wings',     desc: '+5% move speed',       cost: 8,  max: 3, apply: (p) => { p.speed *= 1.05; } },
  keen_eyes:       { name: 'Keen Eyes',        desc: '+10% XP magnet range', cost: 6,  max: 3, apply: (p) => { p.magnetRange *= 1.1; } },
  thick_hide:      { name: 'Thick Hide',       desc: '+0.5 HP regen',        cost: 10, max: 3, apply: (p) => { p.hpRegen += 0.5; } },
  fury:            { name: 'Fury',             desc: '+5% damage',           cost: 12, max: 5, apply: (p) => { p.damageMulti *= 1.05; } },

  // --- Starting loadout ---
  extra_heart:     { name: 'Extra Heart',      desc: 'Start with +25 HP',    cost: 15, max: 1, apply: (p) => { p.maxHp += 25; p.hp += 25; } },
  headstart:       { name: 'Headstart',        desc: 'Start at level 2',     cost: 20, max: 1, apply: (p) => { /* trigger a free level-up at game start */ } },
  double_weapon:   { name: 'Dual Wield',       desc: 'Start with 2 weapons', cost: 30, max: 1, apply: (p) => { /* add second random weapon */ } },

  // --- Cosmetics ---
  skin_gold:       { name: 'Golden Dragon',    desc: 'Gold player skin',     cost: 25, max: 1, cosmetic: true },
  skin_shadow:     { name: 'Shadow Dragon',    desc: 'Dark purple skin',     cost: 25, max: 1, cosmetic: true },
  trail_fire:      { name: 'Fire Trail',       desc: 'Leave flame particles', cost: 15, max: 1, cosmetic: true },

  // --- Weapon variants ---
  spit_homing:     { name: 'Homing Spit',      desc: 'Spit projectiles track enemies slightly', cost: 40, max: 1, weaponMod: 'spit' },
  breath_frost:    { name: 'Frost Breath',      desc: 'Breath slows enemies 20%',               cost: 40, max: 1, weaponMod: 'breath' },
};
```

### Storage Format

**localStorage (SP and MP client):**

```js
// Key: 'survivors_prestige'
{
  scales: 142,              // total unspent
  totalEarned: 350,         // lifetime earned (for stats display)
  unlocks: {
    tough_scales: 3,        // purchased 3 of 5
    swift_wings: 1,
    skin_gold: 1,
    // ... only entries with count > 0
  },
  milestones: ['milestone_w10', 'milestone_w20'],
}
```

**Server sync (optional, for MP persistence):**

Not required for v1. If added later, the server stores prestige data keyed by player name (or a cookie-based session ID). The `welcome` response would include the player's prestige state, and the server applies unlocks to `makePlayer()`.

### How Unlocks Modify Gameplay

**On game start (SP: `initGame()`, MP: `makePlayer()`):**

```js
function applyPrestigeUnlocks(player) {
  const data = loadPrestige(); // from localStorage
  for (const [id, count] of Object.entries(data.unlocks)) {
    const unlock = UNLOCKS[id];
    if (!unlock || unlock.cosmetic) continue;
    for (let i = 0; i < count; i++) {
      unlock.apply(player);
    }
  }
}
```

**Cosmetics** are checked at render time:
```js
const prestige = loadPrestige();
const skin = prestige.unlocks.skin_gold ? 'player_gold' :
             prestige.unlocks.skin_shadow ? 'player_shadow' : 'player';
drawSprite(skin, p.x, p.y, 2);
```

### UI

**Prestige shop** — accessible from the start screen and death screen. A new overlay panel:

```html
<div id="prestige-shop">
  <h2>DRAGON SCALES: <span id="scale-count">0</span></h2>
  <div class="unlock-grid">
    <!-- Generated from UNLOCKS -->
    <div class="unlock-card">
      <div class="unlock-icon">🐉</div>
      <div class="unlock-name">Tough Scales (3/5)</div>
      <div class="unlock-desc">+10 max HP</div>
      <div class="unlock-cost">5 scales</div>
    </div>
  </div>
</div>
```

**Dragon Scales earned** — shown on death screen after the run stats:

```
YOU EARNED: 12 DRAGON SCALES
(wave 10 + 2 kill bonus + 5 milestone bonus)
```

### Files to Modify

| File | Changes |
|------|---------|
| **New: `src/shared/prestige.js`** | UNLOCKS definitions, `calculateScales()`, `loadPrestige()`, `savePrestige()`, `applyPrestigeUnlocks()` |
| `src/main.js` | Call `applyPrestigeUnlocks(player)` in `initGame()` (~line 427). Show scales earned on death screen (~line 749). Add prestige shop button to start/death screens. |
| `src/mp-main.js` | Same prestige application. Could be client-only (unlocks applied before sending join, adjust starting stats). |
| `template.html` | Add prestige shop overlay HTML + CSS. Add "SHOP" button to start screen. Add scales-earned section to death screen. |
| `server.mjs` | Optional: accept prestige-modified stats from client (trust model) or apply server-side (secure model). For v1, client-side only is fine — it's a PvE game. |

### Implementation Steps

1. Create `prestige.js` with UNLOCKS data, localStorage load/save, earn formula.
2. Add `applyPrestigeUnlocks()` call to SP `initGame()`.
3. Add scales-earned display to death screen.
4. Build prestige shop UI (start screen button, overlay, purchase flow).
5. Add cosmetic rendering hooks (skins, trails).
6. Add weapon variant mods (homing spit, frost breath — modify weapon behavior in weapons_runtime.js).

### Estimated Complexity

**Medium.** Core unlock system (steps 1-4) is straightforward localStorage + UI work: 6-8 hours. Weapon variants (step 6) are the trickiest — each one requires new behavior in `weapons_runtime.js`. Cosmetics (step 5) require new sprite assets. Total: 10-14 hours.

---

## Feature 4: Weapon Evolutions

### Overview

New evolution combinations beyond the existing `dragon_storm` (spit + breath). Each evolution fuses two maxed weapons into a powerful combined weapon. Design 3 new evolutions with stats, visual descriptions, and detection/fusion logic.

### Existing Evolution Pattern

`evo_dragon_storm` (powerups.js:34-46):
- **Prereq:** `spit_up` stack >= 3 AND `breath_up` stack >= 3
- **Effect:** Removes spit + breath weapons, adds `dragon_storm` weapon
- **Detection:** `hidden` getter returns true unless prereqs met — evolution only appears as a level-up choice when both weapons are maxed

### New Evolutions

#### 1. Thunder God (Chain Lightning + Lightning Field)

**Prereqs:** `chain_up` >= 3 AND `lightning_field_up` >= 3

**Weapon stats:**
```js
case 'thunder_god': return {
  type: 'thunder_god', cooldown: 0.8, timer: 0,
  damage: 35, range: 300, chainRange: 180, chains: 5,
  color: '#00d2d3',
  // Field component: permanent AoE
  fieldRadius: 180, fieldDamage: 12, zapCount: 5,
  // New mechanic: overcharge — every 4th fire, double damage + stun
  fireCount: 0, overchargeEvery: 4,
};
```

**Behavior:** Fires chain lightning that bounces to 5 targets (up from 2+3). Maintains a permanent lightning field (180 radius, 5 zaps). Every 4th fire triggers an "overcharge" — all enemies in field take 2x damage and are stunned (speed = 0) for 0.3s.

**Visual:** Electric blue aura with constant arcing between random points. Overcharge flash is a bright white pulse expanding outward.

**Powerup entry:**
```js
{
  id: 'evo_thunder_god', name: 'THUNDER GOD',
  desc: 'Chain + Field fuse into omni-lightning with overcharge stun',
  icon: '⚡', stack: 0, max: 1,
  get hidden() { /* check chain_up >= 3 && lightning_field_up >= 3 */ },
  apply(g, p) {
    p.weapons = p.weapons.filter(w => w.type !== 'chain' && w.type !== 'lightning_field');
    p.weapons.push(createWeapon('thunder_god'));
    emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'thunder_god' });
  }
}
```

#### 2. Meteor Orbit (Meteor + Blade Orbit)

**Prereqs:** `meteor_up` >= 3 AND `orbit_up` >= 3

**Weapon stats:**
```js
case 'meteor_orbit': return {
  type: 'meteor_orbit', cooldown: 2.0, timer: 0,
  damage: 60, blastRadius: 80,
  color: '#ff6348',
  // Orbit component
  bladeCount: 4, radius: 90, rotSpeed: 4, bladeDamage: 20,
  phase: 0,
  // New mechanic: orbiting blades trigger mini-meteors on kill
  miniMeteorDamage: 30, miniMeteorRadius: 40,
};
```

**Behavior:** 4 orbiting flame blades (faster, wider orbit). Periodically drops a large meteor. When an orbiting blade kills an enemy, a mini-meteor explodes at the kill location (30 damage, 40 radius).

**Visual:** Orange-red orbiting flames (larger than standard blades, leave particle trails). Meteors have a fiery descent animation.

**Powerup entry:**
```js
{
  id: 'evo_meteor_orbit', name: 'METEOR ORBIT',
  desc: 'Orbit + Meteor fuse into flame blades that trigger explosions on kill',
  icon: '🔥', stack: 0, max: 1,
  get hidden() { /* check meteor_up >= 3 && orbit_up >= 3 */ },
  apply(g, p) {
    p.weapons = p.weapons.filter(w => w.type !== 'meteor' && w.type !== 'orbit');
    p.weapons.push(createWeapon('meteor_orbit'));
    emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'meteor_orbit' });
  }
}
```

#### 3. Fortress (Barrier + Bull Rush)

**Prereqs:** `shield_up` >= 3 AND `charge_up` >= 3

**Weapon stats:**
```js
case 'fortress': return {
  type: 'fortress', cooldown: 2.0, timer: 0,
  // Shield component (always-on)
  shieldRadius: 80, shieldDamage: 30, knockback: 350,
  color: '#74b9ff', phase: 0,
  // Charge component
  chargeDamage: 80, chargeSpeed: 600, chargeDuration: 0.4, chargeWidth: 60,
  active: false, chargeTimer: 0, chargeDx: 0, chargeDy: 0,
  // New mechanic: shockwave — charge endpoint creates radial knockback
  shockwaveRadius: 120, shockwaveDamage: 40,
};
```

**Behavior:** Permanent barrier shield (larger, stronger knockback). Periodically charges in facing direction. On charge completion, emits a shockwave at the endpoint — radial knockback + damage to all enemies in 120 radius.

**Visual:** Glowing blue hexagonal shield. Charge leaves a blue-white trail. Shockwave is an expanding ring at the endpoint.

**Powerup entry:**
```js
{
  id: 'evo_fortress', name: 'FORTRESS',
  desc: 'Shield + Charge fuse into battering ram with shockwave',
  icon: '🏰', stack: 0, max: 1,
  get hidden() { /* check shield_up >= 3 && charge_up >= 3 */ },
  apply(g, p) {
    p.weapons = p.weapons.filter(w => w.type !== 'shield' && w.type !== 'charge');
    p.weapons.push(createWeapon('fortress'));
    emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'fortress' });
  }
}
```

### Detection/Fusion Logic

The existing pattern in `powerups.js` uses a `hidden` getter. For MP compatibility (Feature 1), refactor to a function:

```js
// In powerups.js — new helper
function evoHidden(reqA, reqB, stackSource) {
  const a = stackSource ? (stackSource[reqA] || 0) : (POWERUPS.find(p => p.id === reqA)?.stack || 0);
  const b = stackSource ? (stackSource[reqB] || 0) : (POWERUPS.find(p => p.id === reqB)?.stack || 0);
  return !(a >= 3 && b >= 3);
}

// Evolution entries use it:
{ id: 'evo_thunder_god', ...,
  get hidden() { return evoHidden('chain_up', 'lightning_field_up'); },
  isHidden(stacks) { return evoHidden('chain_up', 'lightning_field_up', stacks); },
}
```

SP uses `hidden` (getter, reads global stacks). MP server uses `isHidden(player.powerupStacks)`.

### Level-Up System Integration

Evolutions appear in the level-up choice pool only when prerequisites are met. They have `max: 1` so they appear once. When chosen:

1. Both source weapons are removed from `p.weapons`
2. The evolution weapon is added
3. An `EVT.EVOLUTION` event fires (screen shake + particles)
4. The evolution powerup's stack is set to 1 (prevents re-offering)

### Files to Modify

| File | Changes |
|------|---------|
| `src/shared/weapons.js` | Add `thunder_god`, `meteor_orbit`, `fortress` to `createWeapon()` switch + WEAPON_ICONS |
| `src/shared/sim/weapons_runtime.js` | Add fire/tick functions: `fireThunderGod`, `tickMeteorOrbit`, `tickFortress`, `tickFortressCharge`. Wire into `fireWeapon()`, `updateWeapons()`, `updateAuras()`. |
| `src/shared/sim/powerups.js` | Add 3 new evo entries to POWERUPS. Refactor `hidden` to support both SP (global stacks) and MP (per-player stacks). |
| `src/main.js` | Add rendering for new weapon auras/effects. Add evolution sfx cases to `handleSimEvent`. |
| `src/mp-main.js` | Add rendering for new weapon auras/effects (MP renders weapon types from snapshot). |
| `server.mjs` | No changes if evolution logic stays in shared sim — just needs weapon types in snapshot (already sends `w.type`). |

### Implementation Steps

1. Add weapon definitions to `weapons.js` (3 new entries in createWeapon).
2. Implement fire/tick logic in `weapons_runtime.js` — this is the bulk of the work.
3. Add powerup entries to `powerups.js` with hidden gates.
4. Refactor hidden getter to support per-player stacks (for MP).
5. Add SP rendering (auras, effects, particles).
6. Add MP rendering (weapon type -> visual mapping).
7. Test balance — tune damage/cooldown numbers.

### Estimated Complexity

**Medium.** Each evolution weapon needs ~50-80 lines of fire/tick logic in `weapons_runtime.js` plus ~30-50 lines of rendering. The pattern is well-established by `dragon_storm`. Main risk is balance — the "mini-meteor on kill" mechanic for Meteor Orbit and the "stun on overcharge" for Thunder God need careful tuning to avoid being OP. Total: 8-12 hours for all 3 evolutions.

---

## Summary

| Feature | Priority | Effort | Dependencies |
|---------|----------|--------|-------------|
| 1. MP/SP Parity | P0 | 10-12h | None | ✅ Shipped (PRs #33-36) |
| 2. Maps System | P1 | 8-10h | None | ✅ Shipped (PR #37) |
| 3. Prestige / Dragon Scales | P2 | 10-14h | None |
| 4. Weapon Evolutions | P2 | 8-12h | Feature 1 | In progress (tiny) |
| 5. Enemy Flocking | P1 | 4-6h | None — pure sim change |

Feature 1 should be done first — it unblocks all MP-visible features. Features 2-4 can be parallelized after that.

---

## Feature 5: Enemy Flocking System

### Overview

All non-special enemies (blob, fast, tank, swarm, brute, elite) use identical movement logic — beeline toward nearest player at their speed value (`enemies.js:131-133`). Only ghost (orbit) and boss (stalk/charge) have unique AI. This makes enemy behavior feel samey despite different stats, and causes same-type enemies to clump into overlapping balls since they all path identically.

A Craig Reynolds Boids-style flocking system adds three steering forces per enemy per tick, with per-type parameters that give each enemy a distinct movement personality. The existing spatial-hash repulsion (`updateRepulsion`, enemies.js:166-206) already does O(N) neighbor lookups and can be extended for flock queries.

### Steering Forces

Each tick, every flocking enemy computes three vectors from its **nearby same-type neighbors** (within `perceptionRadius`):

| Force | What it does | Vector computation |
|-------|-------------|-------------------|
| **Separation** | Steer away from nearby flock-mates to avoid piling up | Sum of `(myPos - neighborPos) / distance` for each neighbor within separation radius |
| **Alignment** | Match heading of nearby flock-mates so groups sweep in formation | Average velocity (heading × speed) of neighbors |
| **Cohesion** | Steer toward center of mass of nearby flock-mates | `(flockCenter - myPos)` normalized |

The final velocity blends these with the existing "chase nearest player" vector:

```
steering = chase * chaseWeight
         + separation * sepWeight
         + alignment * alignWeight
         + cohesion * cohWeight
velocity = normalize(steering) * speed
```

### Per-Type Parameters

Each enemy type gets a `flock` config object in `enemyTypes.js`:

```js
// Added to each ENEMY_TYPES entry
flock: {
  perceptionRadius: 120,  // how far to look for same-type neighbors
  sepWeight: 1.0,         // separation force multiplier
  alignWeight: 0.5,       // alignment force multiplier
  cohWeight: 0.3,         // cohesion force multiplier
  chaseWeight: 1.0,       // player-chase force multiplier
  sepRadius: 30,          // minimum desired spacing from flock-mates
}
```

| Type | Behavior goal | sepW | alignW | cohW | chaseW | perceptionR | sepR |
|------|--------------|------|--------|------|--------|-------------|------|
| `swarm` | Tight swirling packs — dangerous in groups, easy to AoE | 0.5 | 1.2 | 1.0 | 0.8 | 100 | 15 |
| `blob` | Classic horde — moderate clumping, steady advance | 0.8 | 0.5 | 0.3 | 1.0 | 120 | 25 |
| `fast` | Scattered flankers — spread wide, attack from angles | 1.5 | 0.3 | 0.1 | 1.2 | 150 | 40 |
| `tank` | Spread formation — hard to AoE, steady pressure | 1.8 | 0.4 | 0.2 | 0.8 | 140 | 50 |
| `brute` | Lone chargers — ignore other brutes, beeline player | 2.0 | 0.0 | 0.0 | 1.5 | 80 | 60 |
| `elite` | Small tactical squads — moderate formation | 1.0 | 0.8 | 0.6 | 1.0 | 130 | 35 |
| `ghost` | Keeps existing orbit AI — flocking disabled | — | — | — | — | — | — |
| `boss` | Keeps existing stalk/charge AI — flocking disabled | — | — | — | — | — | — |
| `spawner` | Slow drifters — very loose, stay away from each other | 2.0 | 0.1 | 0.0 | 0.6 | 100 | 50 |

### Implementation Plan

#### File: `src/shared/sim/enemies.js`

1. **Extend spatial hash to track enemy type.** The existing `updateRepulsion` builds a spatial hash with cell size 50. Reuse this hash (or build once, use twice) for flock neighbor queries. The hash bucket already stores indices into `g.enemies`, so type lookup is `g.enemies[j].name`.

2. **New function `computeFlockSteering(g, e, neighbors)`:**
   - Input: game state, the enemy, list of neighbor indices from spatial hash
   - Filters to same-type neighbors within `perceptionRadius`
   - Computes separation, alignment, cohesion vectors
   - Returns combined steering vector (not yet normalized)

3. **Modify `updateEnemyTick` (line 116-160):**
   - Before the movement block (line 128-135), compute flock steering for the enemy
   - Replace the simple chase logic with the weighted blend
   - Ghost and boss skip flocking (keep existing AI)
   - Normalize final steering vector, multiply by speed × dt

4. **Merge repulsion into flocking.** The current `updateRepulsion` pass is type-blind push-apart. Once separation is per-type and properly tuned, the brute-force repulsion pass can be removed or reduced to a lightweight overlap-only correction (preventing actual sprite overlap without affecting steering).

#### File: `src/shared/enemyTypes.js`

5. **Add `flock` config to each `ENEMY_TYPES` entry.** Default values for any type without explicit config: `{ perceptionRadius: 120, sepWeight: 1.0, alignWeight: 0.5, cohWeight: 0.3, chaseWeight: 1.0, sepRadius: 30 }`.

6. **`scaleEnemy` copies flock params** from base type to spawned instance (already spreads `...base`, so this is automatic).

### Performance Considerations

- **Spatial hash reuse:** Build the hash once per tick in `updateEnemies`, pass it to both the flock steering pass and the repulsion/overlap correction pass. Current hash build is ~0.2ms for 200 enemies.
- **Same-type filter:** For each enemy, only iterate neighbors in the 9-cell window (typically 5-15 enemies) and skip different types. This is O(N × K) where K is average neighbors per cell — much cheaper than O(N²).
- **Skip when solo:** If an enemy has zero same-type neighbors within perception radius, fall back to pure chase (no wasted vector math).
- **Normalize once:** Compute all three force vectors as simple sums, blend with weights, then normalize the final result once. Avoids 3 separate sqrt calls per enemy.

### Emergent Behaviors to Expect

- **Swarm pincer attacks:** High alignment + cohesion means swarm packs will arc around obstacles together rather than getting stuck in a line. They'll naturally split into sub-groups that approach from different angles.
- **Tank walls:** High separation means tanks spread into a line perpendicular to the player, creating a "wall" that's hard to dodge through.
- **Fast flanking:** Low cohesion + high separation means fast enemies scatter wide and come from unexpected directions — players can't just kite in one direction.
- **Brute isolation:** Near-zero flocking means brutes path independently, arriving at staggered times — each one is a mini-event rather than a clump.

### Balance Tuning

All weights are in `enemyTypes.js` as plain numbers — no code changes needed to adjust. Start with the values above, playtest, and tune. Key knobs:
- If enemies feel too scattered: increase `cohWeight`
- If enemies stack up: increase `sepWeight` or `sepRadius`
- If enemies circle forever without attacking: increase `chaseWeight`
- If a type feels identical to another: differentiate their `alignWeight` (formation vs chaos)

### Estimated Complexity

**Medium.** The core flocking math is ~40-50 lines. Spatial hash is already built. Per-type params are data. Main work is integrating the steering blend into the existing movement code without breaking ghost/boss AI, and tuning the weights to feel good. Total: 4-6 hours including playtesting.

### Dependencies

None — pure sim change in `enemies.js` + `enemyTypes.js`. Works in SP and MP automatically since both run `tickSim`.
