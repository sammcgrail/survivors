// Pure weapon definitions + icon map. Both v1a and v1b read from here.
// Keep free of game-state mutations and DOM/canvas references.

export const WEAPON_ICONS = {
  spit: '🔮', breath: '🌀', charge: '🐂',
  orbit: '🗡️', chain: '⚡', meteor: '☄️',
  shield: '🛡️', lightning_field: '⚡',
  dragon_storm: '🐉',
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
      type: 'shield', cooldown: 99999, timer: 99999, damage: 20, radius: 50,
      color: '#74b9ff', knockback: 200, phase: 0,
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
    default: return null;
  }
}
