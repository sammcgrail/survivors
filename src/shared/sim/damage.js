// Damage application + on-kill consequences (gem drop, heart drop, kill
// count, death-hook mechanics like splitter/bomber). Pure sim — emits
// ENEMY_HIT / ENEMY_KILLED for the client to turn into sfx, floating
// text, particles.
import { spawnGem } from './gems.js';
import { EVT, emit } from './events.js';
import { consumableDrop, spawnConsumable } from './consumables.js';
import { ENEMY_TYPES, scaleEnemy } from '../enemyTypes.js';

// Tier set for the overkill gate below — punch-frame feedback only
// fires on enemies heavy enough to be worth the screen flash, so one-
// shotting trash (blob, swarm, fast) doesn't spam the effect.
const IS_THREAT_TIER = {
  elite: true, brute: true, spawner: true, boss: true, healer: true,
};

// Heart drop chance per enemy type, gated on wave 6+. Tougher enemies
// drop more often; bosses always drop.
function heartDropChance(name) {
  if (name === 'boss') return 1.0;
  if (name === 'elite' || name === 'brute') return 0.25;
  return 0.12;
}

export function spawnHeart(g, x, y, heal) {
  g.heartDrops.push({ x, y, heal, radius: 8, life: 12, bobPhase: g.rng.range(0, Math.PI * 2) });
}

// Splitter death: spawn `count` swarmlings at the death site, scattered
// within the enemy's configured `radius`. Children scale to current
// wave so they keep up with the difficulty curve.
function applySplitOnDeath(g, e) {
  const cfg = e.splitOn;
  const base = ENEMY_TYPES.find(t => t.name === cfg.name);
  if (!base) return;
  for (let i = 0; i < cfg.count; i++) {
    const a = g.rng.random() * Math.PI * 2;
    const r = g.rng.random() * cfg.radius;
    const child = scaleEnemy(base, g.wave, g.rng);
    child.x = e.x + Math.cos(a) * r;
    child.y = e.y + Math.sin(a) * r;
    g.enemies.push(child);
  }
}

// Bomber death: queue a meteor-effect ring (warn → explode) that
// damages players inside on the explode frame. Uses the same path
// meteor_orbit uses for chain-reaction mini-meteors, so no new
// renderer logic needed.
function applyExplodeOnDeath(g, e) {
  const cfg = e.explodeOn;
  g.meteorEffects.push({
    x: e.x, y: e.y,
    radius: cfg.radius,
    damage: cfg.damage,
    life: 0.3, phase: 'warn',
    color: e.color, owner: null,
    // Enemy-source flag — updateMeteorEffects hits players instead of
    // enemies when this is set. sourceName rides into the PLAYER_HIT
    // event so the death feed reads "killed by bomber".
    targetsPlayer: true, sourceName: e.name,
  });
  emit(g, EVT.METEOR_WARN, { x: e.x, y: e.y, radius: cfg.radius });
}

// Returns true when this call killed the enemy (enables on-kill hooks
// like meteor_orbit's mini-meteor trigger); false on hit-but-alive or
// already-dying calls.
export function damageEnemy(g, e, dmg, killerId) {
  if (e.dying) return false;
  // Overkill metric: compare the dealt damage against the enemy's
  // remaining HP BEFORE the hit. A 3x-or-more overkill flags the kill
  // for extra client VFX (punch-frame + burst bump). Only meaningful
  // when this call also kills the enemy; flag is passed into
  // ENEMY_KILLED below. Read pre-hit so a 1-HP enemy with a 100-dmg
  // meteor overkills at 100x, not 1x.
  const preHitHp = e.hp;
  e.hp -= dmg;
  e.hitFlash = 1;
  // dmg < 5 hits never trigger client visuals (text/sfx/crit gated
  // at >= 5), so skip emission server-side. Drops the bandwidth
  // pressure from breath weapons fanning out across many enemies
  // every tick — was the dominant event volume in 8-player MP.
  if (dmg >= 5) {
    emit(g, EVT.ENEMY_HIT, { x: e.x, y: e.y, radius: e.radius, dmg });
  }
  // Phase 5 resurrection — intercept the first kill in final form
  // and revive at 25% HP with a dramatic burst. Fires once:
  // e.resurrected guards against an infinite revive loop on the next
  // hit. After revival the boss dies normally.
  if (e.hp <= 0 && e.name === 'boss' && e.phase === 5 && !e.resurrected) {
    e.resurrected = true;
    e.hp = Math.ceil(e.maxHp * 0.25);
    e.hitFlash = 1;
    emit(g, EVT.BOSS_RESURRECT, { x: e.x, y: e.y });
    return false;
  }

  if (e.hp <= 0) {
    spawnGem(g, e.x, e.y, e.xp, e.name);
    if (g.wave >= 6 && g.rng.random() < heartDropChance(e.name)) {
      spawnHeart(g, e.x, e.y, 15);
    }
    // Consumable drops — elite/brute/boss only. Wave 4+ so players
    // learn the basic loop before consumables appear.
    if (g.wave >= 4) {
      const cType = consumableDrop(e.name, g.rng);
      if (cType) spawnConsumable(g, e.x, e.y, cType);
    }
    // Death mechanics — splitter spawns swarm minions at the kill
    // site, bomber drops a meteor explosion. Runs before ENEMY_KILLED
    // emits so the new enemies/effects land in the same tick's
    // snapshot for clients.
    if (e.splitOn) applySplitOnDeath(g, e);
    if (e.explodeOn) applyExplodeOnDeath(g, e);
    // Death VFX is driven entirely by the ENEMY_KILLED event in
    // applySimEvent now — per-enemy personality bursts replace the
    // old uniform meteor-ring so kills don't all read like a meteor
    // explosion. Velocity / motion direction lets the renderer
    // shape an asymmetric burst (forward shred for fast enemies,
    // chunky downward debris for tanks, etc).
    emit(g, EVT.ENEMY_KILLED, {
      x: e.x, y: e.y,
      color: e.color, name: e.name, radius: e.radius,
      vx: e.vx, vy: e.vy,
      killer: killerId,
      // Overkill flag — only set when:
      //   (a) the killing blow dealt 3x+ the pre-hit hp, AND
      //   (b) absolute floor of 50 dmg OR enemy is a threat tier
      //       (elite / brute / spawner / boss / healer)
      // The (b) gate keeps spit one-shotting a 10-hp blob from
      // punch-framing every kill in early game. Lets the client add
      // a punch-frame flash + bumped burst count when it matters.
      ...(dmg >= preHitHp * 3 && (dmg >= 50 || IS_THREAT_TIER[e.name])
          ? { overkill: true } : {}),
    });
    e.dying = 0.2; // 200ms death animation
    g.kills++;
    for (const p of g.players) if (p.id === killerId) { p.kills++; break; }
    return true;
  }
  return false;
}
