// Player upgrade catalog. Each entry has id, display fields, max stacks,
// optional `requires` gate, and an apply(g, p) that mutates player state.
// Catalog is data — stack counts live per-player (`p.powerupStacks`) so
// the same catalog drives SP and MP.
import { createWeapon } from '../weapons.js';
import { EVT, emit } from './events.js';

export const POWERUPS = [
  { id: 'speed', name: 'Swift Feet', desc: 'Move 15% faster', icon: '⚡', max: 5, stats: '+15% spd', apply(g, p) { p.speed *= 1.15; } },
  { id: 'damage', name: 'Raw Power', desc: '+25% damage to all weapons', icon: '💥', max: 5, stats: '+25% dmg', apply(g, p) { p.damageMulti *= 1.25; } },
  { id: 'hp_regen', name: 'Regeneration', desc: 'Heal 2 HP/sec', icon: '💚', max: 3, stats: '+2 HP/s', apply(g, p) { p.hpRegen += 2; } },
  { id: 'attack_speed', name: 'Haste', desc: '+20% attack speed', icon: '🔥', max: 5, stats: '+20% atk spd', apply(g, p) { p.attackSpeedMulti *= 1.2; } },
  { id: 'magnet', name: 'Magnet', desc: '+50% XP pickup range', icon: '🧲', max: 3, stats: '+50% pickup range', apply(g, p) { p.magnetRange *= 1.5; } },
  { id: 'max_hp', name: 'Vitality', desc: '+25 max HP, heal to full', icon: '❤️', max: 3, stats: '+25 max HP', apply(g, p) { p.maxHp += 25; p.hp = p.maxHp; } },
  { id: 'projectiles', name: 'Barrage', desc: '+1 projectile to all weapons', icon: '🎯', max: 2, stats: '+1 projectile', apply(g, p) { p.projectileBonus++; } },
  { id: 'size', name: 'Amplify', desc: '+15% weapon size/radius', icon: '🔷', max: 3, stats: '+15% size', apply(g, p) { p.sizeMulti *= 1.15; } },
  { id: 'armor', name: 'Iron Skin', desc: '-2 damage taken per hit', icon: '🪨', max: 3, stats: '-2 dmg taken', apply(g, p) { p.armor += 2; } },
  { id: 'weapon_spit', name: 'Magic Spit', desc: 'Projectile weapon — fires at nearest enemy', icon: '🔮', max: 1, apply(g, p) { p.weapons.push(createWeapon('spit')); } },
  { id: 'weapon_breath', name: 'Dragon Breath', desc: 'Aura weapon — damages nearby enemies', icon: '🌀', max: 1, apply(g, p) { p.weapons.push(createWeapon('breath')); } },
  { id: 'weapon_charge', name: 'Bull Rush', desc: 'Sweep weapon — charges in move direction', icon: '🐂', max: 1, apply(g, p) { p.weapons.push(createWeapon('charge')); } },
  { id: 'weapon_orbit', name: 'Blade Orbit', desc: 'Orbiting blades damage enemies on contact', icon: '🗡️', max: 1, apply(g, p) { p.weapons.push(createWeapon('orbit')); } },
  { id: 'weapon_chain', name: 'Chain Lightning', desc: 'Zaps nearest enemy, chains to 2 more', icon: '⚡', max: 1, apply(g, p) { p.weapons.push(createWeapon('chain')); } },
  { id: 'weapon_meteor', name: 'Meteor', desc: 'Drops AoE on enemy clusters', icon: '☄️', max: 1, apply(g, p) { p.weapons.push(createWeapon('meteor')); } },
  { id: 'weapon_shield', name: 'Barrier', desc: 'Knockback shield — pushes and damages nearby enemies', icon: '🛡️', max: 1, apply(g, p) { p.weapons.push(createWeapon('shield')); } },
  { id: 'weapon_lightning_field', name: 'Lightning Field', desc: 'Passive zaps random nearby enemies', icon: '⚡', max: 1, apply(g, p) { p.weapons.push(createWeapon('lightning_field')); } },
  { id: 'weapon_ice_lance', name: 'Ice Lance', desc: 'High-damage piercing projectile — slows on hit', icon: '❄️', max: 1, apply(g, p) { p.weapons.push(createWeapon('ice_lance')); } },
  // Balance pass 2026-04-15 (VoX): buffed most weapon upgrades, nerfed
  // barrier_up (shield was dominating — players were untouchable with
  // stacked barrier). Non-shield builds now scale harder per stack.
  { id: 'spit_up', name: 'Spit+', desc: 'Extra projectile + pierce', icon: '🔮+', max: 3, requires: 'weapon_spit', stats: '+1 proj · +1 pierce', apply(g, p) { let w = p.weapons.find(w=>w.type==='spit'); if(w){w.count++;w.pierce++;} } },
  { id: 'breath_up', name: 'Breath+', desc: '+40% aura radius', icon: '🌀+', max: 3, requires: 'weapon_breath', stats: '+40% radius', apply(g, p) { let w = p.weapons.find(w=>w.type==='breath'); if(w) w.radius *= 1.4; } },
  { id: 'charge_up', name: 'Rush+', desc: '+50% charge damage & width', icon: '🐂+', max: 3, requires: 'weapon_charge', stats: '+50% dmg · +50% width', apply(g, p) { let w = p.weapons.find(w=>w.type==='charge'); if(w){w.damage*=1.5;w.width*=1.5;} } },
  { id: 'orbit_up', name: 'Orbit+', desc: '+1 blade & +10% rotation', icon: '🗡️+', max: 3, requires: 'weapon_orbit', stats: '+1 blade · +10% rot', apply(g, p) { let w = p.weapons.find(w=>w.type==='orbit'); if(w){w.bladeCount++;w.rotSpeed*=1.1;} } },
  { id: 'chain_up', name: 'Chain+', desc: '+1 chain target & +20% damage', icon: '⚡+', max: 3, requires: 'weapon_chain', stats: '+1 chain · +20% dmg', apply(g, p) { let w = p.weapons.find(w=>w.type==='chain'); if(w){w.chains++;w.damage*=1.2;} } },
  { id: 'meteor_up', name: 'Meteor+', desc: '+50% blast radius & damage', icon: '☄️+', max: 3, requires: 'weapon_meteor', stats: '+50% blast · +50% dmg', apply(g, p) { let w = p.weapons.find(w=>w.type==='meteor'); if(w){w.blastRadius*=1.5;w.damage*=1.5;} } },
  { id: 'shield_up', name: 'Barrier+', desc: '+15% radius & knockback', icon: '🛡️+', max: 3, requires: 'weapon_shield', stats: '+15% radius · +15% knockback', apply(g, p) { let w = p.weapons.find(w=>w.type==='shield'); if(w){w.radius*=1.15;w.knockback*=1.15;} } },
  { id: 'lightning_field_up', name: 'Field+', desc: '+2 zap targets & +25% radius', icon: '⚡+', max: 3, requires: 'weapon_lightning_field', stats: '+2 zaps · +25% radius', apply(g, p) { let w = p.weapons.find(w=>w.type==='lightning_field'); if(w){w.zapCount+=2;w.radius*=1.25;} } },
  { id: 'ice_lance_up', name: 'Ice Lance+', desc: '+30% damage & +1 pierce', icon: '❄️+', max: 3, requires: 'weapon_ice_lance', stats: '+30% dmg · +1 pierce', apply(g, p) { let w = p.weapons.find(w=>w.type==='ice_lance'); if(w){w.damage*=1.3;w.pierce++;} } },
  // EVOLUTIONS: fuse two maxed base weapons into a combined form. Gated
  // by `requiresEvo` — getAvailableChoices hides the entry until both
  // source `_up` stacks hit 3. Each `apply` strips the sources and pushes
  // the evolution, then emits EVT.EVOLUTION for screen-shake + sfx.
  { id: 'evo_dragon_storm', name: 'DRAGON STORM', desc: 'Spit + Breath fuse into homing fireballs + damage aura', icon: '🐉',
    max: 1, requiresEvo: ['spit_up', 'breath_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'spit' && w.type !== 'breath');
      p.weapons.push(createWeapon('dragon_storm'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'dragon_storm', pid: p.id });
    }
  },
  { id: 'evo_thunder_god', name: 'THUNDER GOD', desc: 'Chain + Field fuse into omni-lightning with overcharge stun', icon: '⚡',
    max: 1, requiresEvo: ['chain_up', 'lightning_field_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'chain' && w.type !== 'lightning_field');
      p.weapons.push(createWeapon('thunder_god'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'thunder_god', pid: p.id });
    }
  },
  { id: 'evo_meteor_orbit', name: 'METEOR ORBIT', desc: 'Orbit + Meteor fuse into flame blades that trigger explosions on kill', icon: '🔥',
    max: 1, requiresEvo: ['orbit_up', 'meteor_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'orbit' && w.type !== 'meteor');
      p.weapons.push(createWeapon('meteor_orbit'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'meteor_orbit', pid: p.id });
    }
  },
  { id: 'evo_fortress', name: 'FORTRESS', desc: 'Shield + Charge fuse into battering ram with shockwave', icon: '🏰',
    max: 1, requiresEvo: ['shield_up', 'charge_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'shield' && w.type !== 'charge');
      p.weapons.push(createWeapon('fortress'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'fortress', pid: p.id });
    }
  },
  // Cross-pair evolutions: these overlap source weapons with existing
  // evolutions (breath also evolves into dragon_storm; orbit into
  // meteor_orbit). Players pick which path at the level-up screen —
  // only one can apply since each consumes both sources.
  { id: 'evo_inferno_wheel', name: 'INFERNO WHEEL', desc: 'Breath + Orbit fuse into rotating flame blades that apply burn', icon: '🔥',
    max: 1, requiresEvo: ['breath_up', 'orbit_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'breath' && w.type !== 'orbit');
      p.weapons.push(createWeapon('inferno_wheel'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'inferno_wheel', pid: p.id });
    }
  },
  { id: 'evo_void_anchor', name: 'VOID ANCHOR', desc: 'Meteor + Chain fuse into a gravitational pull that crushes enemies on impact', icon: '🌑',
    max: 1, requiresEvo: ['meteor_up', 'chain_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'meteor' && w.type !== 'chain');
      p.weapons.push(createWeapon('void_anchor'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'void_anchor', pid: p.id });
    }
  },
  { id: 'evo_tesla_aegis', name: 'TESLA AEGIS', desc: 'Chain + Shield fuse into a knockback shield that pulse-zaps with slow', icon: '🌩️',
    max: 1, requiresEvo: ['chain_up', 'shield_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'chain' && w.type !== 'shield');
      p.weapons.push(createWeapon('tesla_aegis'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'tesla_aegis', pid: p.id });
    }
  },
  // Ice-lance-pair evolutions — these pick up the "under-represented
  // base" halves from the 24h histogram (breath + meteor each had 1
  // evolution pick across 24 runs) without touching the existing top-
  // pick cluster (orbit / thunder_god / tesla_aegis / void_anchor).
  { id: 'evo_frost_cascade', name: 'FROST CASCADE', desc: 'Ice Lance + Breath fuse into a freezing aura that chains crowd control', icon: '🌨️',
    max: 1, requiresEvo: ['ice_lance_up', 'breath_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'ice_lance' && w.type !== 'breath');
      p.weapons.push(createWeapon('frost_cascade'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'frost_cascade', pid: p.id });
    }
  },
  { id: 'evo_nova_strike', name: 'NOVA STRIKE', desc: 'Ice Lance + Meteor fuse into a meteor that shatters into a ring of slowing ice fragments', icon: '💠',
    max: 1, requiresEvo: ['ice_lance_up', 'meteor_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'ice_lance' && w.type !== 'meteor');
      p.weapons.push(createWeapon('nova_strike'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'nova_strike', pid: p.id });
    }
  },
];

// Filter the catalog to entries the player can pick right now, given
// their per-player stack map. Caller does the random pick.
export function getAvailableChoices(stacks) {
  return POWERUPS.filter(p => {
    if ((stacks[p.id] || 0) >= p.max) return false;
    if (p.requires && (stacks[p.requires] || 0) === 0) return false;
    if (p.requiresEvo && p.requiresEvo.some(req => (stacks[req] || 0) < 3)) return false;
    return true;
  });
}
