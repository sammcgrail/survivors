// Pure weapon definitions + icon map. Both SP and MP read from here.
// Keep free of game-state mutations and DOM/canvas references.
import { formatWeaponCooldown } from './weaponDisplay.js';

export const WEAPON_ICONS = {
  spit: '🔮', breath: '🌀', charge: '🐂',
  orbit: '🗡️', chain: '⚡', meteor: '☄️',
  shield: '🛡️', lightning_field: '⚡',
  dragon_storm: '🐉',
  thunder_god: '⚡', meteor_orbit: '🔥', fortress: '🏰',
  inferno_wheel: '🔥', tesla_aegis: '🌩️',
  void_anchor: '🌑',
};

export function createWeapon(type) {
  switch (type) {
    case 'spit': return {
      // Balance pass 2026-04-15 (bench): damage 15 → 20. Spit was
      // falling off hard by wave 10 (17 DPS vs 185 for field at same
      // wave). Gentle bump keeps it picked as a starter without
      // making Spit+ / dragon_storm paths dominant.
      type: 'spit', cooldown: 0.8, timer: 0, damage: 20, speed: 350,
      range: 300, count: 1, pierce: 1, color: '#9b59b6',
    };
    case 'breath': return {
      type: 'breath', cooldown: 0.5, timer: 0, damage: 8, radius: 80,
      color: '#e67e22', pulsePhase: 0,
    };
    case 'charge': return {
      // Buffed per barn's analysis: was 16 dps (worst weapon), now
      // ~22 dps base + trail damage rewards aggressive pathing.
      type: 'charge', cooldown: 1.8, timer: 0, damage: 40, speed: 500,
      duration: 0.3, width: 55, color: '#e74c3c',
      active: false, chargeTimer: 0, chargeDx: 0, chargeDy: 0,
    };
    case 'orbit': return {
      type: 'orbit', cooldown: 0, timer: 0, damage: 12, radius: 70,
      bladeCount: 2, rotSpeed: 3, color: '#ecf0f1', phase: 0,
    };
    case 'chain': return {
      // Balance pass 2026-04-15 (bench): damage 20 → 28, cooldown 1.2
      // → 0.9, chains 2 → 3. Chain was DECLINING wave 10→18 (101 → 70
      // DPS) because single-target scaling couldn't keep up with HP.
      // Faster fire + one extra bounce keeps it useful late game.
      type: 'chain', cooldown: 0.9, timer: 0, damage: 28, range: 250,
      chainRange: 130, chains: 3, color: '#00d2d3',
    };
    case 'meteor': return {
      type: 'meteor', cooldown: 3.5, timer: 0, damage: 50, blastRadius: 60,
      color: '#ff6348',
    };
    case 'shield': return {
      // Nerfed per VoX 2026-04-15: was radius 50 / damage 20 / knockback 200.
      // Fortress build still carries, but barrier is no longer a
      // "stand still and win" button on its own.
      type: 'shield', cooldown: 99999, timer: 99999, damage: 12, radius: 35,
      color: '#74b9ff', knockback: 100, phase: 0,
    };
    case 'lightning_field': return {
      // Balance pass 2026-04-15 (bench): damage 18 → 22, zapCount 3 → 4.
      // Field was plateauing at ~200 DPS late game while other bases
      // hit 1000+. Extra zap + small damage bump restores parity
      // without making thunder_god more potent (thunder_god has its
      // own damage field, doesn't inherit this).
      type: 'lightning_field', cooldown: 0.6, timer: 0, damage: 22, radius: 140,
      color: '#ffeaa7', zapCount: 4,
    };
    case 'dragon_storm': return {
      type: 'dragon_storm', cooldown: 0.4, timer: 0, damage: 25, speed: 300,
      range: 350, count: 3, pierce: 3, color: '#f39c12',
      auraRadius: 100, auraDamage: 15,
    };
    // Chain + Lightning Field fusion. Fires a 5-target chain and holds a
    // permanent 180u field. Every 4th fire overcharges: 2x field damage
    // + 0.3s stun on everyone in range. `fireCount` gates the overcharge.
    case 'thunder_god': return {
      type: 'thunder_god', cooldown: 0.8, timer: 0,
      damage: 35, range: 300, chainRange: 180, chains: 5,
      fieldRadius: 180, fieldDamage: 12, zapCount: 5,
      fireCount: 0, overchargeEvery: 4,
      color: '#00d2d3',
    };
    // Meteor + Orbit fusion. 4 flame blades at 90u, faster spin. Periodic
    // full meteor on cooldown. Orbit kills trigger mini-meteors at the
    // kill site (30 dmg, 40u blast) — chain-reaction potential.
    case 'meteor_orbit': return {
      type: 'meteor_orbit', cooldown: 2.0, timer: 0,
      damage: 60, blastRadius: 80,
      bladeCount: 4, radius: 90, rotSpeed: 4, bladeDamage: 20,
      miniMeteorDamage: 30, miniMeteorRadius: 40,
      phase: 0, color: '#ff6348',
    };
    // Shield + Charge fusion. Permanent barrier at 80u with stronger
    // knockback; periodic directional charge. Shockwave at charge
    // endpoint radial-knocks + damages inside 120u.
    case 'fortress': return {
      type: 'fortress', cooldown: 2.0, timer: 0,
      shieldRadius: 80, shieldDamage: 30, knockback: 350,
      // Charge fields reuse the same names as weapon 'charge' so fireCharge
      // + the charge sweep tick work unchanged on fortress weapons.
      damage: 80, speed: 600, duration: 0.4, width: 60,
      shockwaveRadius: 120, shockwaveDamage: 40,
      active: false, chargeTimer: 0, chargeDx: 0, chargeDy: 0,
      phase: 0, color: '#74b9ff',
    };
    // Breath + Orbit fusion. 4 rotating flame blades at 85u; each blade
    // has a 32u contact aura that applies burn on hit. No direct meteor
    // or shockwave — pure sustained DoT melee clear.
    //
    // Balance pass 2026-04-15 (bench): bladeDamage 20 → 16. First-run
    // bench showed inferno_wheel at 5067 DPS at wave 18, 27% above the
    // next evolution (fortress at 3977). Nerfed to put it in the
    // evolution band (~4000 DPS) with the others.
    case 'inferno_wheel': return {
      type: 'inferno_wheel', cooldown: 0, timer: 0,
      bladeCount: 4, radius: 85, bladeRadius: 32,
      bladeDamage: 16,
      burnDps: 10, burnDuration: 2.0,
      rotSpeed: 3.2, phase: 0,
      color: '#f39c12',
    };
    // Chain + Shield fusion. Permanent knockback shield + chain pulses
    // every pulseCooldown, slow on every hop. Every 4th pulse is an
    // overcharge: shield expands briefly and stuns everything inside
    // (mirrors thunder_god's rhythmic wipe so chain-evolve paths have
    // the same "climactic beat" signature). pulseTimer is separate from
    // the always-on w.timer so cooldown:99999 never blocks the pulse.
    case 'tesla_aegis': return {
      type: 'tesla_aegis', cooldown: 99999, timer: 99999,
      shieldRadius: 90, shieldDamage: 14, knockback: 140,
      pulseCooldown: 0.5, pulseTimer: 0,
      chainRange: 200, chainDamage: 30, chains: 3,
      pulseCount: 0, overchargeEvery: 4,
      overchargeStun: 0.3, overchargeExpandR: 150, overchargeExpandLife: 0.25,
      phase: 0, pulsePhase: 0,
      color: '#74b9ff',
    };
    case 'void_anchor': return {
      type: 'void_anchor', cooldown: 3.5, timer: 0,
      baseDamage: 45, impactDamage: 110,
      pullRadius: 200, pullStrength: 220,
      impactRadius: 85,
      color: '#6c5ce7',
    };
    default: return null;
  }
}

// Level-up card preview data — role tag + evolution source pair.
// Kept here next to createWeapon() so new weapons have one obvious
// place to slot their meta. Role taxonomy is deliberately small so
// players parse the tag at a glance:
//   PROJECTILE — fires a travelling thing
//   AURA       — damages around player continuously
//   CAST       — summons an effect at a target or position
//   DASH       — player-movement sweep
//   SHIELD     — passive push + damage around player
export const WEAPON_ROLE = {
  spit:            'PROJECTILE',
  breath:          'AURA',
  charge:          'DASH',
  orbit:           'AURA',
  chain:           'CAST',
  meteor:          'CAST',
  shield:          'SHIELD',
  lightning_field: 'AURA',
  dragon_storm:    'PROJECTILE',
  thunder_god:     'CAST',
  meteor_orbit:    'AURA',
  fortress:        'DASH',
  inferno_wheel:   'AURA',
  void_anchor:     'CAST',
  tesla_aegis:     'SHIELD',
};

// Evolution source pair — two base weapon types that fuse into the
// evolution. Level-up cards render the source icons (not names) per
// seb's steer: faster to parse and mirrors the HUD icon grammar.
export const WEAPON_EVO_SOURCES = {
  dragon_storm:  ['spit', 'breath'],
  thunder_god:   ['chain', 'lightning_field'],
  meteor_orbit:  ['orbit', 'meteor'],
  fortress:      ['shield', 'charge'],
  inferno_wheel: ['breath', 'orbit'],
  void_anchor:   ['meteor', 'chain'],
  tesla_aegis:   ['chain', 'shield'],
};

// Strip the prefix and return a weapon type the createWeapon() factory
// understands, or null for non-weapon powerups (stat buffs etc).
export function powerupWeaponType(id) {
  if (id.startsWith('weapon_')) return id.slice(7);
  if (id.startsWith('evo_'))    return id.slice(4);
  return null;
}

// Compact preview for the level-up card: role chip, headline stats line,
// evo source icons when applicable. Pure derivation from createWeapon()
// so stat tuning flows through automatically.
export function getWeaponPreview(type) {
  const w = createWeapon(type);
  if (!w) return null;
  const role = WEAPON_ROLE[type] || 'AURA';
  const parts = [];
  // Damage field naming varies per weapon — pick the most representative
  // field for the card's one-line stat summary.
  const dmg = w.damage || w.baseDamage || w.bladeDamage || w.shieldDamage || w.chainDamage;
  if (dmg) parts.push(`${Math.round(dmg)} dmg`);
  // Cooldown: sentinel 99999 → "passive"; always-on pulse weapons show pulse cadence.
  const cdStr = formatWeaponCooldown(w);
  if (cdStr) parts.push(cdStr);
  // Reach field — whichever the weapon reports first.
  const reach = w.range || w.radius || w.blastRadius || w.shieldRadius || w.fieldRadius || w.pullRadius;
  if (reach) parts.push(`${Math.round(reach)}u reach`);
  return {
    role,
    stats: parts.join(' · '),
    evoSources: WEAPON_EVO_SOURCES[type] || null,
  };
}
