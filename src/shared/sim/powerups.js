// Player upgrade catalog. Each entry has id, display fields, max stacks,
// optional `requires` gate, and an apply(g, p) that mutates player state.
// Catalog is data — stack counts live per-player (`p.powerupStacks`) so
// the same catalog drives SP and MP.
import { createWeapon } from '../weapons.js';
import { EVT, emit } from './events.js';

export const POWERUPS = [
  { id: 'speed', name: 'Swift Feet', desc: 'Move 15% faster', icon: '⚡', max: 5, apply(g, p) { p.speed *= 1.15; } },
  { id: 'damage', name: 'Raw Power', desc: '+25% damage to all weapons', icon: '💥', max: 5, apply(g, p) { p.damageMulti *= 1.25; } },
  { id: 'hp_regen', name: 'Regeneration', desc: 'Heal 2 HP/sec', icon: '💚', max: 3, apply(g, p) { p.hpRegen += 2; } },
  { id: 'attack_speed', name: 'Haste', desc: '+20% attack speed', icon: '🔥', max: 5, apply(g, p) { p.attackSpeedMulti *= 1.2; } },
  { id: 'magnet', name: 'Magnet', desc: '+50% XP pickup range', icon: '🧲', max: 3, apply(g, p) { p.magnetRange *= 1.5; } },
  { id: 'max_hp', name: 'Vitality', desc: '+25 max HP, heal to full', icon: '❤️', max: 3, apply(g, p) { p.maxHp += 25; p.hp = p.maxHp; } },
  { id: 'weapon_spit', name: 'Magic Spit', desc: 'Projectile weapon — fires at nearest enemy', icon: '🔮', max: 1, apply(g, p) { p.weapons.push(createWeapon('spit')); } },
  { id: 'weapon_breath', name: 'Dragon Breath', desc: 'Aura weapon — damages nearby enemies', icon: '🌀', max: 1, apply(g, p) { p.weapons.push(createWeapon('breath')); } },
  { id: 'weapon_charge', name: 'Bull Rush', desc: 'Sweep weapon — charges in move direction', icon: '🐂', max: 1, apply(g, p) { p.weapons.push(createWeapon('charge')); } },
  { id: 'weapon_orbit', name: 'Blade Orbit', desc: 'Orbiting blades damage enemies on contact', icon: '🗡️', max: 1, apply(g, p) { p.weapons.push(createWeapon('orbit')); } },
  { id: 'weapon_chain', name: 'Chain Lightning', desc: 'Zaps nearest enemy, chains to 2 more', icon: '⚡', max: 1, apply(g, p) { p.weapons.push(createWeapon('chain')); } },
  { id: 'weapon_meteor', name: 'Meteor', desc: 'Drops AoE on enemy clusters', icon: '☄️', max: 1, apply(g, p) { p.weapons.push(createWeapon('meteor')); } },
  { id: 'weapon_shield', name: 'Barrier', desc: 'Knockback shield — pushes and damages nearby enemies', icon: '🛡️', max: 1, apply(g, p) { p.weapons.push(createWeapon('shield')); } },
  { id: 'weapon_lightning_field', name: 'Lightning Field', desc: 'Passive zaps random nearby enemies', icon: '⚡', max: 1, apply(g, p) { p.weapons.push(createWeapon('lightning_field')); } },
  // Balance pass 2026-04-15 (VoX): buffed most weapon upgrades, nerfed
  // barrier_up (shield was dominating — players were untouchable with
  // stacked barrier). Non-shield builds now scale harder per stack.
  { id: 'spit_up', name: 'Spit+', desc: 'Extra projectile + pierce', icon: '🔮+', max: 3, requires: 'weapon_spit', apply(g, p) { let w = p.weapons.find(w=>w.type==='spit'); if(w){w.count++;w.pierce++;} } },
  { id: 'breath_up', name: 'Breath+', desc: '+40% aura radius', icon: '🌀+', max: 3, requires: 'weapon_breath', apply(g, p) { let w = p.weapons.find(w=>w.type==='breath'); if(w) w.radius *= 1.4; } },
  { id: 'charge_up', name: 'Rush+', desc: '+50% charge damage & width', icon: '🐂+', max: 3, requires: 'weapon_charge', apply(g, p) { let w = p.weapons.find(w=>w.type==='charge'); if(w){w.damage*=1.5;w.width*=1.5;} } },
  { id: 'orbit_up', name: 'Orbit+', desc: '+1 blade & +10% rotation', icon: '🗡️+', max: 3, requires: 'weapon_orbit', apply(g, p) { let w = p.weapons.find(w=>w.type==='orbit'); if(w){w.bladeCount++;w.rotSpeed*=1.1;} } },
  { id: 'chain_up', name: 'Chain+', desc: '+1 chain target & +20% damage', icon: '⚡+', max: 3, requires: 'weapon_chain', apply(g, p) { let w = p.weapons.find(w=>w.type==='chain'); if(w){w.chains++;w.damage*=1.2;} } },
  { id: 'meteor_up', name: 'Meteor+', desc: '+50% blast radius & damage', icon: '☄️+', max: 3, requires: 'weapon_meteor', apply(g, p) { let w = p.weapons.find(w=>w.type==='meteor'); if(w){w.blastRadius*=1.5;w.damage*=1.5;} } },
  { id: 'shield_up', name: 'Barrier+', desc: '+15% radius & knockback', icon: '🛡️+', max: 3, requires: 'weapon_shield', apply(g, p) { let w = p.weapons.find(w=>w.type==='shield'); if(w){w.radius*=1.15;w.knockback*=1.15;} } },
  { id: 'lightning_field_up', name: 'Field+', desc: '+2 zap targets & +25% radius', icon: '⚡+', max: 3, requires: 'weapon_lightning_field', apply(g, p) { let w = p.weapons.find(w=>w.type==='lightning_field'); if(w){w.zapCount+=2;w.radius*=1.25;} } },
  // EVOLUTIONS: fuse two maxed base weapons into a combined form. Gated
  // by `requiresEvo` — getAvailableChoices hides the entry until both
  // source `_up` stacks hit 3. Each `apply` strips the sources and pushes
  // the evolution, then emits EVT.EVOLUTION for screen-shake + sfx.
  { id: 'evo_dragon_storm', name: 'DRAGON STORM', desc: 'Spit + Breath fuse into homing fireballs + damage aura', icon: '🐉',
    max: 1, requiresEvo: ['spit_up', 'breath_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'spit' && w.type !== 'breath');
      p.weapons.push(createWeapon('dragon_storm'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'dragon_storm' });
    }
  },
  { id: 'evo_thunder_god', name: 'THUNDER GOD', desc: 'Chain + Field fuse into omni-lightning with overcharge stun', icon: '⚡',
    max: 1, requiresEvo: ['chain_up', 'lightning_field_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'chain' && w.type !== 'lightning_field');
      p.weapons.push(createWeapon('thunder_god'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'thunder_god' });
    }
  },
  { id: 'evo_meteor_orbit', name: 'METEOR ORBIT', desc: 'Orbit + Meteor fuse into flame blades that trigger explosions on kill', icon: '🔥',
    max: 1, requiresEvo: ['orbit_up', 'meteor_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'orbit' && w.type !== 'meteor');
      p.weapons.push(createWeapon('meteor_orbit'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'meteor_orbit' });
    }
  },
  { id: 'evo_fortress', name: 'FORTRESS', desc: 'Shield + Charge fuse into battering ram with shockwave', icon: '🏰',
    max: 1, requiresEvo: ['shield_up', 'charge_up'],
    apply(g, p) {
      p.weapons = p.weapons.filter(w => w.type !== 'shield' && w.type !== 'charge');
      p.weapons.push(createWeapon('fortress'));
      emit(g, EVT.EVOLUTION, { x: p.x, y: p.y, name: 'fortress' });
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
