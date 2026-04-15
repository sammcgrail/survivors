// Client-side handler for sim events. SP drains `g.events` directly;
// MP drains `state.events` shipped on each snapshot (Tier C). Both
// land here so sfx, particles, floating text, screen shake, and
// per-event gating stay identical across modes.
//
// Callers supply a `client` object — a per-mode shim:
//   particles, floatingTexts — arrays to push into
//   sfx(name)               — play a sound (no-op if mute)
//   shake(value)            — raise screen-shake (max-merge)
//   flash(value)            — raise level-flash overlay (SP only; MP no-ops)
//   isMe(pid)               — true when this event targets the viewer
//                              (SP: always true since there's one player;
//                               MP: pid === myId)
//   onLevelUp(evt)          — DOM flip for the level-up choice menu
//   onPlayerDeath(evt)      — DOM flip for the death screen + death feed
//   onWaveSurvived(evt)     — death-feed entry for the banner
//
// Visual/audio side-effects fire for every viewer; DOM-flip
// callbacks are optional and only make sense for the player whose
// pid matches the event.

function spawnParticleBurst(particles, x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 150;
    const life = 0.3 + Math.random() * 0.4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life, maxLife: life,
      color,
      radius: 2 + Math.random() * 3,
    });
  }
}

export function applySimEvent(evt, client) {
  const isMe = client.isMe ? client.isMe(evt.pid) : true;
  const sfx = client.sfx || (() => {});
  const shake = client.shake || (() => {});
  const flash = client.flash || (() => {});
  const spawn = (x, y, color, count) => spawnParticleBurst(client.particles, x, y, color, count);

  switch (evt.type) {
    case 'gemPickup':
      if (isMe) sfx('xp');
      client.floatingTexts.push({
        x: evt.x, y: evt.y, text: '+' + evt.xp,
        color: '#3498db', life: 0.8, maxLife: 0.8, vy: -60,
      });
      spawn(evt.x, evt.y, '#3498db', 3);
      break;

    case 'heartPickup':
      if (isMe) sfx('heal');
      if (evt.healed > 0) {
        client.floatingTexts.push({
          x: evt.x, y: evt.y, text: '+' + Math.floor(evt.healed) + ' HP',
          color: '#2ecc71', life: 0.8, maxLife: 0.8, vy: -50,
        });
      }
      spawn(evt.x, evt.y, '#e74c3c', 4);
      break;

    case 'enemyHit':
      // Gated to dmg >= 5 so breath ticks don't spam text/sfx.
      if (evt.dmg >= 5) {
        sfx('hit');
        const crit = evt.dmg >= 50;
        client.floatingTexts.push({
          x: evt.x + (Math.random() - 0.5) * 10,
          y: evt.y - (evt.radius || 10) - 4,
          text: crit ? Math.floor(evt.dmg) + '!' : String(Math.floor(evt.dmg)),
          color: crit ? '#f39c12' : '#f1c40f',
          life: crit ? 0.7 : 0.5, maxLife: crit ? 0.7 : 0.5, vy: -40,
        });
        if (crit) spawn(evt.x, evt.y, '#f39c12', 6);
      }
      break;

    case 'enemyKilled': {
      sfx('kill');
      // Particle count + shake scale with enemy radius.
      const r = evt.radius || 10;
      const big = r >= 18, huge = r >= 30;
      spawn(evt.x, evt.y, evt.color, huge ? 40 : big ? 20 : Math.max(8, Math.round(r * 1.2)));
      if (big) spawn(evt.x, evt.y, '#ffffff', huge ? 15 : 6);
      if (huge)      shake(0.4);
      else if (big)  shake(0.15);
      if (huge)      flash(0.12);
      break;
    }

    case 'playerHit':
      if (isMe) { shake(0.15); sfx('playerhit'); }
      spawn(evt.x, evt.y, '#e74c3c', 5);
      break;

    case 'playerDeath':
      if (isMe) sfx('death');
      if (client.onPlayerDeath) client.onPlayerDeath(evt);
      break;

    case 'levelUp':
      if (isMe) {
        flash(0.15);
        if (client.onLevelUp) client.onLevelUp(evt);
        else sfx('levelup');
      }
      break;

    case 'weaponFire':
      if (!isMe) break;
      if (evt.weapon === 'spit')              sfx('spit');
      else if (evt.weapon === 'chain')        sfx('chain');
      else if (evt.weapon === 'dragon_storm') sfx('dragonstorm');
      else if (evt.weapon === 'thunder_god')  sfx('chain');
      break;

    case 'chargeBurst':
      if (isMe) { shake(0.1); sfx('charge'); }
      spawn(evt.x, evt.y, evt.color, 8);
      break;

    case 'shieldHum':
      if (isMe) sfx('shield_hum');
      break;

    case 'chainZap':
      if (isMe) sfx('zap');
      break;

    case 'meteorWarn':
      // warn ring lives in g.meteorEffects; no side effect needed.
      break;

    case 'meteorExplode':
      if (isMe) shake(0.1);
      sfx('meteor');
      spawn(evt.x, evt.y, evt.color, 12);
      break;

    case 'bossStep':
      sfx('boss_step');
      break;

    case 'bossTelegraph':
      spawn(evt.x, evt.y, '#d63031', 12);
      sfx('boss_telegraph');
      break;

    case 'hiveBurst':
      spawn(evt.x, evt.y, '#fdcb6e', 8);
      sfx('hive_burst');
      break;

    case 'evolution':
      if (isMe) shake(0.5);
      spawn(evt.x, evt.y, '#f39c12', 20);
      break;

    case 'waveSurvived':
      if (client.onWaveSurvived) client.onWaveSurvived(evt);
      break;
  }
}
