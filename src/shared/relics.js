// Relic catalog. Rare passive items dropped in chests by bosses, elites,
// and wave milestones. Walk-over auto-pickup, stack additively, persist
// for the run only. Pattern-matches powerups.js: each entry has id, name,
// icon (emoji), desc, apply(g, player), max_stacks.
//
// Stack counts live per-player (`p.relics`) so the same catalog drives
// SP and MP.

export const RELICS = [
  {
    id: 'glass_cannon', name: 'Glass Cannon', icon: '\uD83D\uDD2B',
    desc: '+50% damage, -25% max HP', max_stacks: 3,
    apply(g, p) { p.damageMulti *= 1.5; p.maxHp = Math.floor(p.maxHp * 0.75); if (p.hp > p.maxHp) p.hp = p.maxHp; },
  },
  {
    id: 'vampire_fang', name: 'Vampire Fang', icon: '\uD83E\uDDB7',
    desc: 'Heal 1 HP per kill', max_stacks: 3,
    apply(g, p) { p.vampireHeal = (p.vampireHeal || 0) + 1; },
  },
  {
    id: 'lightning_rod', name: 'Lightning Rod', icon: '\u26A1',
    desc: '+1 chain bounce on chain/thunder weapons', max_stacks: 3,
    apply(g, p) {
      for (const w of p.weapons) {
        if (w.chains !== undefined) w.chains++;
      }
    },
  },
  {
    id: 'phoenix_heart', name: 'Phoenix Heart', icon: '\uD83D\uDD25',
    desc: 'Auto-revive once at 50% HP (consumed on use)', max_stacks: 1,
    apply(g, p) { p.phoenixHeart = true; },
  },
  {
    id: 'hoarder', name: 'Hoarder', icon: '\uD83D\uDCB0',
    desc: '+25% gem XP value', max_stacks: 3,
    apply(g, p) { p.xpMulti = (p.xpMulti || 1) * 1.25; },
  },
  {
    id: 'time_slip', name: 'Time Slip', icon: '\u23F3',
    desc: '-10% enemy speed (global)', max_stacks: 3,
    apply(g, p) { g.enemySpeedMulti = (g.enemySpeedMulti || 1) * 0.9; },
  },
  {
    id: 'trickster', name: 'Trickster', icon: '\uD83C\uDFB2',
    desc: '10% chance for 3x damage on hit', max_stacks: 3,
    apply(g, p) { p.critChance = (p.critChance || 0) + 0.10; },
  },
  {
    id: 'shieldbreaker', name: 'Shieldbreaker', icon: '\u2694\uFE0F',
    desc: '+15% damage vs armored enemies (boss/brute/elite)', max_stacks: 3,
    apply(g, p) { p.armoredDmgBonus = (p.armoredDmgBonus || 0) + 0.15; },
  },
  {
    id: 'ember_orb', name: 'Ember Orb', icon: '\uD83D\uDD34',
    desc: '5% chance to burn enemies on hit (3 dps for 3s)', max_stacks: 3,
    apply(g, p) { p.emberChance = (p.emberChance || 0) + 0.05; },
  },
  {
    id: 'iron_will', name: 'Iron Will', icon: '\uD83D\uDEE1\uFE0F',
    desc: '+2 armor (flat damage reduction)', max_stacks: 3,
    apply(g, p) { p.armor += 2; },
  },
];

// Pick a random relic the player hasn't maxed yet. Returns null if all
// relics are at max stacks.
export function pickRelic(playerRelics, rng) {
  const available = RELICS.filter(r => (playerRelics[r.id] || 0) < r.max_stacks);
  if (available.length === 0) return null;
  return rng.pick(available);
}
