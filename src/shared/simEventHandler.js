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

// Lower-level helper for per-personality death bursts. Keeps the
// math obvious and lets each enemy type tune speed/life/radius/
// angle distribution + biases without nesting a dozen optional
// params into spawnParticleBurst.
function pushFx(particles, x, y, color, opts) {
  const angle = opts.angle != null ? opts.angle : Math.random() * Math.PI * 2;
  const speed = opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin);
  const life = opts.lifeMin + Math.random() * (opts.lifeMax - opts.lifeMin);
  const r = opts.radiusMin + Math.random() * (opts.radiusMax - opts.radiusMin);
  particles.push({
    x, y,
    vx: Math.cos(angle) * speed + (opts.biasX || 0),
    vy: Math.sin(angle) * speed + (opts.biasY || 0),
    life, maxLife: life,
    color,
    radius: r,
  });
}

// Per-enemy death VFX. Replaces the old uniform meteor-ring with
// bursts shaped by the dying enemy's personality — swarm flickers
// out fast, tank craters with chunky debris, brute violently
// explodes, boss gets a multi-layer finale. Quick, uneven, and
// readable at a glance.
function enemyDeathBurst(particles, evt) {
  const { x, y, color, name } = evt;
  const r = evt.radius || 10;
  const motion = Math.atan2(evt.vy || 0, evt.vx || 0);
  const moving = (evt.vx || evt.vy) !== 0;

  switch (name) {
    case 'swarm':
      // Tiny, fast, gone in a blink.
      for (let i = 0; i < 5; i++) {
        pushFx(particles, x, y, color, {
          speedMin: 80, speedMax: 200,
          lifeMin: 0.15, lifeMax: 0.3,
          radiusMin: 1, radiusMax: 2,
        });
      }
      break;

    case 'fast':
      // Forward shred — particles spray in the motion direction.
      for (let i = 0; i < 10; i++) {
        const baseAngle = moving ? motion : Math.random() * Math.PI * 2;
        const spread = (Math.random() - 0.5) * 1.6; // ~90° cone
        pushFx(particles, x, y, color, {
          angle: baseAngle + spread,
          speedMin: 120, speedMax: 280,
          lifeMin: 0.2, lifeMax: 0.4,
          radiusMin: 1.5, radiusMax: 3,
        });
      }
      // 4 white sparks for the impact pop
      for (let i = 0; i < 4; i++) {
        pushFx(particles, x, y, '#ffffff', {
          speedMin: 180, speedMax: 260,
          lifeMin: 0.1, lifeMax: 0.2,
          radiusMin: 1, radiusMax: 1.8,
        });
      }
      break;

    case 'tank':
      // Chunky crater — large dark debris, slow, gravity-tending.
      for (let i = 0; i < 10; i++) {
        pushFx(particles, x, y, color, {
          speedMin: 30, speedMax: 110,
          lifeMin: 0.4, lifeMax: 0.7,
          radiusMin: 3.5, radiusMax: 6,
          biasY: 40, // crumble downward
        });
      }
      // 5 inner red flecks
      for (let i = 0; i < 5; i++) {
        pushFx(particles, x, y, '#c0392b', {
          speedMin: 50, speedMax: 130,
          lifeMin: 0.25, lifeMax: 0.5,
          radiusMin: 1.5, radiusMax: 2.5,
        });
      }
      break;

    case 'brute': {
      // Violent explosion — wide spread, intense, white-hot core.
      for (let i = 0; i < 24; i++) {
        pushFx(particles, x, y, color, {
          speedMin: 130, speedMax: 320,
          lifeMin: 0.25, lifeMax: 0.55,
          radiusMin: 2, radiusMax: 4.5,
        });
      }
      // 8 white-hot core sparks
      for (let i = 0; i < 8; i++) {
        pushFx(particles, x, y, '#ffffff', {
          speedMin: 200, speedMax: 350,
          lifeMin: 0.15, lifeMax: 0.3,
          radiusMin: 1, radiusMax: 2,
        });
      }
      // 6 dark red embers that linger
      for (let i = 0; i < 6; i++) {
        pushFx(particles, x, y, '#7b1212', {
          speedMin: 40, speedMax: 100,
          lifeMin: 0.5, lifeMax: 0.8,
          radiusMin: 2, radiusMax: 3,
        });
      }
      break;
    }

    case 'elite': {
      // Bright punctuation — body color + gold accents.
      for (let i = 0; i < 18; i++) {
        pushFx(particles, x, y, color, {
          speedMin: 120, speedMax: 240,
          lifeMin: 0.3, lifeMax: 0.55,
          radiusMin: 2, radiusMax: 3.5,
        });
      }
      for (let i = 0; i < 10; i++) {
        pushFx(particles, x, y, '#f1c40f', {
          speedMin: 160, speedMax: 280,
          lifeMin: 0.2, lifeMax: 0.4,
          radiusMin: 1.2, radiusMax: 2.2,
        });
      }
      break;
    }

    case 'spawner': {
      // Hive pop — yellow-green spore burst, slow, long-lived,
      // drifting outward + slightly down.
      for (let i = 0; i < 22; i++) {
        const c = Math.random() < 0.5 ? '#fdcb6e' : '#a3cb38';
        pushFx(particles, x, y, c, {
          speedMin: 40, speedMax: 130,
          lifeMin: 0.5, lifeMax: 0.9,
          radiusMin: 2, radiusMax: 3.5,
          biasY: 20,
        });
      }
      break;
    }

    case 'boss': {
      // Multi-layer finale.
      // Layer 1 — bright outer body burst.
      for (let i = 0; i < 36; i++) {
        pushFx(particles, x, y, color, {
          speedMin: 150, speedMax: 360,
          lifeMin: 0.35, lifeMax: 0.7,
          radiusMin: 2.5, radiusMax: 5,
        });
      }
      // Layer 2 — white-hot core sparks (fast, short-lived).
      for (let i = 0; i < 18; i++) {
        pushFx(particles, x, y, '#ffffff', {
          speedMin: 240, speedMax: 420,
          lifeMin: 0.15, lifeMax: 0.3,
          radiusMin: 1.2, radiusMax: 2.2,
        });
      }
      // Layer 3 — chunky dark debris that lingers and falls.
      for (let i = 0; i < 14; i++) {
        pushFx(particles, x, y, '#5d1414', {
          speedMin: 60, speedMax: 180,
          lifeMin: 0.6, lifeMax: 1.0,
          radiusMin: 3, radiusMax: 5.5,
          biasY: 50,
        });
      }
      break;
    }

    case 'ghost':
      // Dissipation — pale wisps drifting upward, long fade.
      for (let i = 0; i < 8; i++) {
        pushFx(particles, x, y, '#dfdfdf', {
          speedMin: 20, speedMax: 60,
          lifeMin: 0.6, lifeMax: 0.9,
          radiusMin: 2, radiusMax: 3.5,
          biasY: -50,
        });
      }
      break;

    case 'blob':
    default: {
      // Default kill — modest burst keyed off enemy radius.
      const count = Math.max(6, Math.round(r * 1.0));
      for (let i = 0; i < count; i++) {
        pushFx(particles, x, y, color, {
          speedMin: 70, speedMax: 200,
          lifeMin: 0.2, lifeMax: 0.45,
          radiusMin: 1.8, radiusMax: 3.2,
        });
      }
      break;
    }
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
      // Per-enemy personality death burst — shapes particles by
      // type (swarm flickers, fast shreds forward, tank craters,
      // brute violently explodes, boss multi-layer finale, ghost
      // wisps up, etc). Replaces the old uniform meteor-style ring.
      enemyDeathBurst(client.particles, evt);
      // Shake + flash only for the killer — peers shouldn't get
      // cross-map screen shake when a friend kills a boss on the
      // other side of the arena.
      const r = evt.radius || 10;
      const big = r >= 18, huge = r >= 30;
      const killedIt = !client.isMe || client.isMe(evt.killer);
      if (killedIt && huge)      shake(0.4);
      else if (killedIt && big)  shake(0.15);
      if (killedIt && huge)      flash(0.12);
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

    case 'consumableSpawn':
      // Soft sparkle at spawn point so players notice the drop.
      spawn(evt.x, evt.y, evt.color || '#f39c12', 5);
      break;

    case 'consumablePickup': {
      if (isMe) sfx('powerup');
      // Floating text with the item label.
      client.floatingTexts.push({
        x: evt.x, y: evt.y,
        text: evt.label || evt.type.toUpperCase(),
        color: evt.color || '#f39c12',
        life: 1.0, maxLife: 1.0, vy: -50,
      });
      // Pickup burst — color-matched, generous.
      spawn(evt.x, evt.y, evt.color || '#f39c12', 12);
      if (isMe) shake(0.12);
      break;
    }
  }
}
