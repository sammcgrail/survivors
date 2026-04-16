# Adding a weapon

A new weapon lives across six files. This doc is the copy-paste
checklist — hit each section in order and the weapon picks up sim
runtime + SP render + MP sync + level-up card + VFX automatically.

Keep this in sync with reality when weapons change. If you add a step
or a gotcha, put it here.

## 1. `src/shared/weapons.js`

Two things:

**a. Add an entry to `WEAPON_ICONS`** (one emoji):

```js
export const WEAPON_ICONS = {
  // ...existing...
  my_weapon: '🎯',
};
```

**b. Add a `case` to `createWeapon(type)`** returning the weapon's
initial state. Every field your fire/tick functions read must be here
or MP players picking it up from a snapshot will hit `undefined`.

```js
case 'my_weapon': return {
  type: 'my_weapon', cooldown: 1.0, timer: 0,
  damage: 20, range: 300, pierce: 1,
  color: '#f39c12',
};
```

Conventions for field names (so preview + existing helpers read
automatically — see `getWeaponPreview`):

- Damage: `damage` (or `baseDamage` / `bladeDamage` / `shieldDamage` /
  `chainDamage` if the weapon has multiple modes)
- Cooldown: `cooldown` (seconds). Set to `99999` for always-on auras;
  the preview helper maps that to `"passive"`.
- Reach: `range` for projectiles, `radius` for auras, `blastRadius` for
  AoE, `shieldRadius` / `fieldRadius` / `pullRadius` for specifics
- Render color: `color: '#rrggbb'`

**c. Register the role** in `WEAPON_ROLE` (one of `PROJECTILE / AURA /
CAST / DASH / SHIELD`):

```js
export const WEAPON_ROLE = {
  // ...existing...
  my_weapon: 'PROJECTILE',
};
```

**d. If the weapon is an evolution**, add its source pair to
`WEAPON_EVO_SOURCES`:

```js
export const WEAPON_EVO_SOURCES = {
  // ...existing...
  my_evo: ['base_a', 'base_b'],
};
```

## 2. `src/shared/sim/weapons_runtime.js`

**a. If it fires on cooldown**, add a `fire…` function and a dispatch
branch in `fireWeapon`:

```js
function fireMyWeapon(g, w, p) {
  // target selection, damage, projectile spawn / chain points / meteor
  // push, etc. Emit WEAPON_FIRE for the muzzle bloom (see step 5).
  emit(g, EVT.WEAPON_FIRE, { weapon: 'my_weapon', x: p.x, y: p.y, pid: p.id });
  // ...
}

function fireWeapon(g, w, p) {
  // ...existing branches...
  else if (w.type === 'my_weapon') fireMyWeapon(g, w, p);
}
```

**b. If it has an always-on tick** (aura / shield / rotating blades),
add a `tick…` call in `updateWeapons`:

```js
if (w.type === 'my_weapon') tickMyWeapon(g, w, p, dt);
```

Any aura tick that damages enemies should loop with squared-distance
checks (`dx*dx + dy*dy < r*r`), not `Math.hypot` — that's in the hot
path and hypot shows up in profiles at wave 25+.

## 3. `src/shared/sim/powerups.js`

Add a catalog entry:

```js
{ id: 'weapon_my_weapon', name: 'My Weapon', desc: 'What it does',
  icon: '🎯', max: 1,
  apply(g, p) { p.weapons.push(createWeapon('my_weapon')); } },
```

For weapon upgrades (`_up` stacks):

```js
{ id: 'my_weapon_up', name: 'My Weapon+', desc: '+1 proj · +10% dmg',
  icon: '🎯+', max: 3, requires: 'weapon_my_weapon',
  stats: '+1 proj · +10% dmg',
  apply(g, p) { let w = p.weapons.find(w=>w.type==='my_weapon');
                if(w){w.count++; w.damage*=1.1;} } },
```

For evolutions:

```js
{ id: 'evo_my_evo', name: 'MY EVO', desc: 'A + B fuse into …',
  icon: '✦', max: 1, requiresEvo: ['base_a_up', 'base_b_up'],
  apply(g, p) {
    p.weapons = p.weapons.filter(w => w.type !== 'base_a' && w.type !== 'base_b');
    p.weapons.push(createWeapon('my_evo'));
    emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'my_evo', pid: p.id });
  } },
```

## 4. `src/shared/render.js`

Add a draw branch inside the per-weapon switch in the player pass
(search `drawWeapons` / the existing `if (w.type === ...)` blocks
around line 636+). Aura types draw a translucent ring, projectile
types draw via `drawProjectiles` automatically.

Gotcha: if the weapon defines a `radius` / `shieldRadius` etc. that
scales with `p.sizeMulti`, multiply at render time — `w.radius`
itself is the base value.

## 5. `src/shared/simEventHandler.js`

**a. SFX**: add a branch for the fire sound in the `weaponFire`
handler:

```js
else if (evt.weapon === 'my_weapon') sfx('myweaponsound');
```

**b. Muzzle / cast bloom**: add a palette entry to `MUZZLE_STYLES`
keyed on the weapon type. Evolutions pick hues from their source pair
(see the existing entries as template):

```js
const MUZZLE_STYLES = {
  // ...existing...
  my_weapon: { bright: '#...', trail: '#...' },
};
```

For evolutions also flip `EVOLVED_WEAPONS`:

```js
const EVOLVED_WEAPONS = {
  // ...existing...
  my_evo: true,
};
```

That gives the bigger bloom (7 bright + 3 trail + 8-particle halo
ring).

## 6. `server.mjs` — `snapshotWeapon()`

MP syncs weapons by shipping a subset of fields in each snapshot. Add
every field the renderer needs to read for this weapon to the switch:

```js
if (w.type === 'my_weapon') {
  o.range = w.range; o.pierce = w.pierce;
}
```

If you skip this step, SP looks fine but MP renders the weapon as a
blank / default — the classic silent-drift bug.

## Evolution matrix (current)

| Evolution | Source pair (`_up` ×3 each) | Role |
|---|---|---|
| `dragon_storm` | `spit_up` + `breath_up` | PROJECTILE |
| `thunder_god` | `chain_up` + `lightning_field_up` | CAST |
| `meteor_orbit` | `orbit_up` + `meteor_up` | AURA |
| `fortress` | `shield_up` + `charge_up` | DASH |
| `inferno_wheel` | `breath_up` + `orbit_up` | AURA |
| `void_anchor` | `meteor_up` + `chain_up` | CAST |
| `tesla_aegis` | `chain_up` + `shield_up` | SHIELD |

Notes:

- `breath` and `orbit` each appear in two evo pairs (dragon_storm /
  inferno_wheel for breath; meteor_orbit / inferno_wheel for orbit).
  Players pick their path at level-up — each evolution consumes both
  sources so only one path applies per run.
- `chain` appears in three evo pairs (thunder_god, void_anchor,
  tesla_aegis). Same one-path-per-run rule.

## Final pre-commit checklist

Run through this before pushing — it's ~60 seconds and catches most
drift:

- [ ] `createWeapon('my_weapon')` returns every field the runtime,
      render, and snapshot code will read
- [ ] `fireWeapon` or `updateWeapons` dispatches to the new handler
- [ ] `POWERUPS` has the weapon entry (and evo / `_up` if relevant)
- [ ] `render.js` has a draw branch
- [ ] `simEventHandler.js` has sfx + muzzle style (and
      `EVOLVED_WEAPONS[name] = true` if evo)
- [ ] `snapshotWeapon()` in `server.mjs` ships the fields the
      renderer needs
- [ ] `npm test && npm run build` is clean
