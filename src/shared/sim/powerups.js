// Player upgrade catalog. Each entry has id, display fields, stack/max,
// optional `requires` gate, and an apply(g) that mutates the game state.
// `hidden` is a getter for unlock-on-condition entries (e.g. evolutions).
// Pure sim — apply functions emit EVT events for visual side-effects.
import { createWeapon } from '../weapons.js';
import { EVT, emit } from './events.js';

export const POWERUPS = [
  { id: 'speed', name: 'Swift Feet', desc: 'Move 15% faster', icon: '⚡', stack: 0, max: 5, apply(g) { g.player.speed *= 1.15; } },
  { id: 'damage', name: 'Raw Power', desc: '+25% damage to all weapons', icon: '💥', stack: 0, max: 5, apply(g) { g.player.damageMulti *= 1.25; } },
  { id: 'hp_regen', name: 'Regeneration', desc: 'Heal 2 HP/sec', icon: '💚', stack: 0, max: 3, apply(g) { g.player.hpRegen += 2; } },
  { id: 'attack_speed', name: 'Haste', desc: '+20% attack speed', icon: '🔥', stack: 0, max: 5, apply(g) { g.player.attackSpeedMulti *= 1.2; } },
  { id: 'magnet', name: 'Magnet', desc: '+50% XP pickup range', icon: '🧲', stack: 0, max: 3, apply(g) { g.player.magnetRange *= 1.5; } },
  { id: 'max_hp', name: 'Vitality', desc: '+25 max HP, heal to full', icon: '❤️', stack: 0, max: 3, apply(g) { g.player.maxHp += 25; g.player.hp = g.player.maxHp; } },
  { id: 'weapon_spit', name: 'Magic Spit', desc: 'Projectile weapon — fires at nearest enemy', icon: '🔮', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('spit')); } },
  { id: 'weapon_breath', name: 'Dragon Breath', desc: 'Aura weapon — damages nearby enemies', icon: '🌀', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('breath')); } },
  { id: 'weapon_charge', name: 'Bull Rush', desc: 'Sweep weapon — charges in move direction', icon: '🐂', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('charge')); } },
  { id: 'weapon_orbit', name: 'Blade Orbit', desc: 'Orbiting blades damage enemies on contact', icon: '🗡️', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('orbit')); } },
  { id: 'weapon_chain', name: 'Chain Lightning', desc: 'Zaps nearest enemy, chains to 2 more', icon: '⚡', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('chain')); } },
  { id: 'weapon_meteor', name: 'Meteor', desc: 'Drops AoE on enemy clusters', icon: '☄️', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('meteor')); } },
  { id: 'weapon_shield', name: 'Barrier', desc: 'Knockback shield — pushes and damages nearby enemies', icon: '🛡️', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('shield')); } },
  { id: 'weapon_lightning_field', name: 'Lightning Field', desc: 'Passive zaps random nearby enemies', icon: '⚡', stack: 0, max: 1, apply(g) { g.player.weapons.push(createWeapon('lightning_field')); } },
  { id: 'spit_up', name: 'Spit+', desc: 'Extra projectile + pierce', icon: '🔮+', stack: 0, max: 3, requires: 'weapon_spit', apply(g) { let w = g.player.weapons.find(w=>w.type==='spit'); if(w){w.count++;w.pierce++;} } },
  { id: 'breath_up', name: 'Breath+', desc: '+30% aura radius', icon: '🌀+', stack: 0, max: 3, requires: 'weapon_breath', apply(g) { let w = g.player.weapons.find(w=>w.type==='breath'); if(w) w.radius *= 1.3; } },
  { id: 'charge_up', name: 'Rush+', desc: '+40% charge damage & width', icon: '🐂+', stack: 0, max: 3, requires: 'weapon_charge', apply(g) { let w = g.player.weapons.find(w=>w.type==='charge'); if(w){w.damage*=1.4;w.width*=1.4;} } },
  { id: 'orbit_up', name: 'Orbit+', desc: '+1 orbiting blade', icon: '🗡️+', stack: 0, max: 3, requires: 'weapon_orbit', apply(g) { let w = g.player.weapons.find(w=>w.type==='orbit'); if(w) w.bladeCount++; } },
  { id: 'chain_up', name: 'Chain+', desc: '+1 chain target', icon: '⚡+', stack: 0, max: 3, requires: 'weapon_chain', apply(g) { let w = g.player.weapons.find(w=>w.type==='chain'); if(w) w.chains++; } },
  { id: 'meteor_up', name: 'Meteor+', desc: '+40% blast radius & damage', icon: '☄️+', stack: 0, max: 3, requires: 'weapon_meteor', apply(g) { let w = g.player.weapons.find(w=>w.type==='meteor'); if(w){w.blastRadius*=1.4;w.damage*=1.4;} } },
  { id: 'shield_up', name: 'Barrier+', desc: '+25% radius & knockback', icon: '🛡️+', stack: 0, max: 3, requires: 'weapon_shield', apply(g) { let w = g.player.weapons.find(w=>w.type==='shield'); if(w){w.radius*=1.25;w.knockback*=1.25;} } },
  { id: 'lightning_field_up', name: 'Field+', desc: '+1 zap target & +20% radius', icon: '⚡+', stack: 0, max: 3, requires: 'weapon_lightning_field', apply(g) { let w = g.player.weapons.find(w=>w.type==='lightning_field'); if(w){w.zapCount++;w.radius*=1.2;} } },
  // EVOLUTION: max spit (4 stacks) + max breath (4 stacks) = Dragon Storm
  { id: 'evo_dragon_storm', name: 'DRAGON STORM', desc: 'Spit + Breath fuse into homing fireballs + damage aura', icon: '🐉',
    stack: 0, max: 1,
    get hidden() {
      const spit = POWERUPS.find(p=>p.id==='spit_up');
      const breath = POWERUPS.find(p=>p.id==='breath_up');
      return !(spit && spit.stack >= 3 && breath && breath.stack >= 3);
    },
    apply(g) {
      g.player.weapons = g.player.weapons.filter(w => w.type !== 'spit' && w.type !== 'breath');
      g.player.weapons.push(createWeapon('dragon_storm'));
      emit(g, EVT.EVOLUTION, { x: g.player.x, y: g.player.y, name: 'dragon_storm' });
    }
  },
];

// Reset all stacks to 0; called when initializing a new game.
export function resetPowerupStacks() {
  POWERUPS.forEach(p => p.stack = 0);
}
