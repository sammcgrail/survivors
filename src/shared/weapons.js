// Pure weapon definitions + icon map. Both SP and MP read from here.
// Keep free of game-state mutations and DOM/canvas references.

export const WEAPON_ICONS = {
  spit: '🔮', breath: '🌀', charge: '🐂',
  orbit: '🗡️', chain: '⚡', meteor: '☄️',
  shield: '🛡️', lightning_field: '⚡',
  dragon_storm: '🐉',
  thunder_god: '⚡', meteor_orbit: '🔥', fortress: '🏰',
};

export function createWeapon(type) {
  switch (type) {
    case 'spit': return {
      type: 'spit', cooldown: 0.8, timer: 0, damage: 15, speed: 350,
      range: 300, count: 1, pierce: 1, color: '#9b59b6',
    };
    case 'breath': return {
      type: 'breath', cooldown: 0.5, timer: 0, damage: 8, radius: 80,
      color: '#e67e22', pulsePhase: 0,
    };
    case 'charge': return {
      type: 'charge', cooldown: 2.5, timer: 0, damage: 40, speed: 500,
      duration: 0.3, width: 40, color: '#e74c3c',
      active: false, chargeTimer: 0, chargeDx: 0, chargeDy: 0,
    };
    case 'orbit': return {
      type: 'orbit', cooldown: 0, timer: 0, damage: 12, radius: 70,
      bladeCount: 2, rotSpeed: 3, color: '#ecf0f1', phase: 0,
    };
    case 'chain': return {
      type: 'chain', cooldown: 1.2, timer: 0, damage: 20, range: 250,
      chainRange: 120, chains: 2, color: '#00d2d3',
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
      type: 'lightning_field', cooldown: 0.6, timer: 0, damage: 18, radius: 140,
      color: '#ffeaa7', zapCount: 3,
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
    default: return null;
  }
}
