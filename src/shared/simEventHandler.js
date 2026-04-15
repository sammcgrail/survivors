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

// Muzzle flash color pairs per weapon — {bright: first bloom, trail:
// slow sparks}. Weapons not listed (breath/orbit/shield — aura types
// with no discrete "shot") skip the muzzle flash entirely.
const MUZZLE_STYLES = {
  spit:         { bright: '#d6a0f5', trail: '#8e44ad' },
  chain:        { bright: '#b7ebff', trail: '#0099cc' },
  dragon_storm: { bright: '#ffd27f', trail: '#e67e22' },
  thunder_god:  { bright: '#e0fdff', trail: '#00d2d3' },
  void_anchor:  { bright: '#c8b6ff', trail: '#6c5ce7' },
};

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

// Player death burst — fires at the dying player's position so
// peers see the moment, not just a player going gray on the next
// snapshot. Cause-aware palette: cursed_ground gets sickly green,
// everything else gets a violent red explosion.
function playerDeathBurst(particles, x, y, by) {
  const isCurse = by === 'cursed_ground';
  const main = isCurse ? '#7bc043' : '#e74c3c';
  const accent = isCurse ? '#c8d635' : '#7b1212';
  // Wide outer body burst.
  for (let i = 0; i < 30; i++) {
    pushFx(particles, x, y, main, {
      speedMin: 140, speedMax: 320,
      lifeMin: 0.35, lifeMax: 0.7,
      radiusMin: 2.5, radiusMax: 4.5,
    });
  }
  // White-hot core sparks.
  for (let i = 0; i < 12; i++) {
    pushFx(particles, x, y, '#ffffff', {
      speedMin: 200, speedMax: 360,
      lifeMin: 0.15, lifeMax: 0.3,
      radiusMin: 1.2, radiusMax: 2.2,
    });
  }
  // Lingering darker debris.
  for (let i = 0; i < 8; i++) {
    pushFx(particles, x, y, accent, {
      speedMin: 50, speedMax: 140,
      lifeMin: 0.6, lifeMax: 0.9,
      radiusMin: 2, radiusMax: 3.5,
    });
  }
}

// Consumable spawn fanfare — fires once when an elite/brute/boss
// drops a rare item. Upward fountain in the item's color + outward
// ring flash so a player panning over later still gets the "oh!"
// landed-here moment. Server already gates this hard (boss 50%,
// elite 6%) so this firing means something landed.
function consumableSpawnFanfare(particles, evt) {
  const { x, y } = evt;
  const color = evt.color || '#f39c12';
  // Outward ring — 16 evenly-spaced particles for a clean shock.
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI * 2 * i) / 16;
    pushFx(particles, x, y, color, {
      angle,
      speedMin: 140, speedMax: 180,
      lifeMin: 0.35, lifeMax: 0.5,
      radiusMin: 1.8, radiusMax: 2.6,
    });
  }
  // Upward fountain — 14 particles biased up + slight outward
  // spread. Reads as the drop "popping" into existence.
  for (let i = 0; i < 14; i++) {
    pushFx(particles, x, y, color, {
      speedMin: 30, speedMax: 100,
      lifeMin: 0.5, lifeMax: 0.85,
      radiusMin: 2, radiusMax: 3.5,
      biasY: -120,
    });
  }
  // White core sparks for the pop accent.
  for (let i = 0; i < 6; i++) {
    pushFx(particles, x, y, '#ffffff', {
      speedMin: 100, speedMax: 200,
      lifeMin: 0.2, lifeMax: 0.35,
      radiusMin: 1.2, radiusMax: 2,
    });
  }
}

// Per-consumable pickup burst — distinct feel per type so the moment
// reads at a glance: bomb explodes outward, magnet pulls inward,
// shield rings out + glows. Players can tell what they grabbed
// without reading the label.
function consumablePickupBurst(particles, evt) {
  const { x, y, ctype } = evt;
  switch (ctype) {
    case 'bomb': {
      // Explosion — wide red+orange spread + white core sparks.
      // Sells the actual blast (the damage already applied through
      // ENEMY_HIT events).
      for (let i = 0; i < 26; i++) {
        const c = Math.random() < 0.5 ? '#e74c3c' : '#f39c12';
        pushFx(particles, x, y, c, {
          speedMin: 140, speedMax: 360,
          lifeMin: 0.3, lifeMax: 0.6,
          radiusMin: 2, radiusMax: 4.5,
        });
      }
      for (let i = 0; i < 10; i++) {
        pushFx(particles, x, y, '#ffffff', {
          speedMin: 220, speedMax: 380,
          lifeMin: 0.15, lifeMax: 0.3,
          radiusMin: 1.2, radiusMax: 2.2,
        });
      }
      break;
    }
    case 'shield': {
      // Outward ring sweep + soft inner glow particles. The blue
      // ring on the ground reads as the shield activating.
      for (let i = 0; i < 24; i++) {
        const angle = (Math.PI * 2 * i) / 24;
        pushFx(particles, x, y, '#74b9ff', {
          angle,
          speedMin: 160, speedMax: 200,
          lifeMin: 0.4, lifeMax: 0.55,
          radiusMin: 2, radiusMax: 3,
        });
      }
      for (let i = 0; i < 8; i++) {
        pushFx(particles, x, y, '#dff3ff', {
          speedMin: 30, speedMax: 90,
          lifeMin: 0.4, lifeMax: 0.7,
          radiusMin: 2.5, radiusMax: 4,
        });
      }
      break;
    }
    case 'magnet': {
      // Inward pull — particles spawn on a ring and converge on
      // the pickup point. Negative speeds + outward angles do that
      // in one go (vx,vy = -cos*speed, -sin*speed = inward motion
      // from a position offset by +cos*startR, +sin*startR).
      for (let i = 0; i < 16; i++) {
        const angle = (Math.PI * 2 * i) / 16 + Math.random() * 0.3;
        const startR = 60 + Math.random() * 30;
        const sx = x + Math.cos(angle) * startR;
        const sy = y + Math.sin(angle) * startR;
        pushFx(particles, sx, sy, '#f39c12', {
          angle: angle + Math.PI, // point back toward center
          speedMin: 220, speedMax: 320,
          lifeMin: 0.25, lifeMax: 0.4,
          radiusMin: 1.5, radiusMax: 2.8,
        });
      }
      // Center burst — gold pulse on arrival.
      for (let i = 0; i < 8; i++) {
        pushFx(particles, x, y, '#f1c40f', {
          speedMin: 60, speedMax: 140,
          lifeMin: 0.3, lifeMax: 0.5,
          radiusMin: 2, radiusMax: 3.2,
        });
      }
      break;
    }
    default: {
      // Unknown / future consumable — fall back to the original
      // generic burst.
      for (let i = 0; i < 12; i++) {
        pushFx(particles, x, y, evt.color || '#f39c12', {
          speedMin: 80, speedMax: 200,
          lifeMin: 0.3, lifeMax: 0.5,
          radiusMin: 2, radiusMax: 3.2,
        });
      }
      break;
    }
  }
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
        // Multi-stage impact: radial debris (fast, short) + trailing
        // sparks (slower, longer). Reads as a hit that blooms + fades,
        // instead of a single puff. Crit gets a denser + brighter
        // version of the same shape.
        const debrisCount = crit ? 8 : 5;
        for (let i = 0; i < debrisCount; i++) {
          pushFx(client.particles, evt.x, evt.y, crit ? '#ffe08a' : '#f1c40f', {
            speedMin: 140, speedMax: 260,
            lifeMin: 0.12, lifeMax: 0.22,
            radiusMin: 1.4, radiusMax: 2.6,
          });
        }
        const sparkCount = crit ? 4 : 2;
        for (let i = 0; i < sparkCount; i++) {
          pushFx(client.particles, evt.x, evt.y, crit ? '#f39c12' : '#f1c40f', {
            speedMin: 40, speedMax: 90,
            lifeMin: 0.35, lifeMax: 0.6,
            radiusMin: 0.8, radiusMax: 1.6,
          });
        }
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
      // Multi-stage: immediate red debris (5 fast) + 3 slower dark-red
      // sparks that linger. Same bloom-then-fade shape as enemy hits
      // so damage feedback reads consistently across targets.
      for (let i = 0; i < 5; i++) {
        pushFx(client.particles, evt.x, evt.y, '#e74c3c', {
          speedMin: 130, speedMax: 230,
          lifeMin: 0.15, lifeMax: 0.28,
          radiusMin: 1.5, radiusMax: 2.8,
        });
      }
      for (let i = 0; i < 3; i++) {
        pushFx(client.particles, evt.x, evt.y, '#7b1212', {
          speedMin: 30, speedMax: 70,
          lifeMin: 0.4, lifeMax: 0.7,
          radiusMin: 0.9, radiusMax: 1.6,
        });
      }
      break;

    case 'playerDeath':
      sfx('death'); // everyone hears it — someone just dropped
      if (isMe) shake(0.45); // big jolt for the dying player
      // Death burst at the player position so peers SEE the kill
      // happen, not just a player going gray on the next snapshot.
      if (evt.x !== undefined) {
        playerDeathBurst(client.particles, evt.x, evt.y, evt.by);
      }
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
      // Muzzle flash — short bloom at the fire origin so every shot has
      // a kinetic starting frame. Same bloom-then-fade shape as damage
      // feedback (PR 1): 5 fast bright particles + 2 slow trail. Per
      // weapon color so each weapon reads distinct at the muzzle.
      if (evt.x !== undefined && evt.y !== undefined) {
        const style = MUZZLE_STYLES[evt.weapon];
        if (style) {
          for (let i = 0; i < 5; i++) {
            pushFx(client.particles, evt.x, evt.y, style.bright, {
              speedMin: 120, speedMax: 220,
              lifeMin: 0.1, lifeMax: 0.18,
              radiusMin: 1.3, radiusMax: 2.4,
            });
          }
          for (let i = 0; i < 2; i++) {
            pushFx(client.particles, evt.x, evt.y, style.trail, {
              speedMin: 40, speedMax: 80,
              lifeMin: 0.25, lifeMax: 0.45,
              radiusMin: 0.9, radiusMax: 1.5,
            });
          }
        }
      }
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

    case 'enemyShoot':
      // Hostile fire — sharp warning sound + muzzle flash particles.
      sfx('spit'); // reuse spit sfx for now — higher pitch reads as hostile
      for (let i = 0; i < 4; i++) {
        pushFx(client.particles, evt.x, evt.y, evt.name === 'boss' ? '#d63031' : '#6c5ce7', {
          speedMin: 40, speedMax: 80,
          lifeMin: 0.15, lifeMax: 0.3,
          radiusMin: 1, radiusMax: 2.5,
        });
      }
      break;

    case 'enemyAim': {
      // Telegraph windup before an enemy fires. Drops a dotted line
      // of color-coded particles between shooter and locked target so
      // the player has a reaction window to step out of the line.
      // Plus a charging burst on the enemy itself so they read as
      // "winding up" even when the player is looking elsewhere.
      const color = evt.name === 'boss' ? '#d63031' : '#6c5ce7';
      const dur = evt.duration || 0.4;
      const dx = (evt.tx - evt.x), dy = (evt.ty - evt.y);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const segments = Math.max(6, Math.min(14, Math.round(dist / 35)));
      for (let i = 1; i <= segments; i++) {
        const t = i / (segments + 1);
        client.particles.push({
          x: evt.x + dx * t,
          y: evt.y + dy * t,
          vx: 0, vy: 0,
          life: dur, maxLife: dur,
          color,
          radius: 1.8 + (1 - t) * 1.2, // bigger near the shooter
        });
      }
      // Charging glow on the enemy — small inward-drifting motes
      // that look like the enemy is gathering energy.
      for (let i = 0; i < 6; i++) {
        const angle = Math.random() * Math.PI * 2;
        const startR = 14 + Math.random() * 10;
        client.particles.push({
          x: evt.x + Math.cos(angle) * startR,
          y: evt.y + Math.sin(angle) * startR,
          vx: -Math.cos(angle) * 60,
          vy: -Math.sin(angle) * 60,
          life: dur * 0.6, maxLife: dur * 0.6,
          color,
          radius: 1.5 + Math.random(),
        });
      }
      break;
    }

    case 'bossPhase': {
      // Phase transition VFX. Each phase escalates intensity:
      //   phase 2 → small burst, brief flash
      //   phase 3 → bigger crimson burst + white sparks + minimap flash
      //   phase 4 → ENRAGED — biggest shake, white screen flash, full
      //             crimson burst with a "ENRAGED" floating banner above
      //             the boss so players know the rules just changed.
      const phase = evt.phase || 2;
      const p4 = phase === 4;
      const p3 = phase === 3;
      shake(p4 ? 0.5 : p3 ? 0.25 : 0.15);
      flash(p4 ? 0.4 : p3 ? 0.20 : 0.12);
      sfx(p4 ? 'boss_step' : 'boss_telegraph');
      const burstColor = p4 ? '#ff2424' : p3 ? '#7b1212' : '#e17055';
      const burstCount = p4 ? 56 : p3 ? 32 : 20;
      for (let i = 0; i < burstCount; i++) {
        pushFx(client.particles, evt.x, evt.y, burstColor, {
          speedMin: p4 ? 140 : 100, speedMax: p4 ? 380 : 300,
          lifeMin: 0.4, lifeMax: 0.9,
          radiusMin: 2, radiusMax: p4 ? 5.5 : 4.5,
        });
      }
      if (p3 || p4) {
        // White-hot sparks for the high-stakes phases. Phase 4 doubles
        // the count to read as another step up.
        const sparks = p4 ? 24 : 12;
        for (let i = 0; i < sparks; i++) {
          pushFx(client.particles, evt.x, evt.y, '#ffffff', {
            speedMin: 200, speedMax: 450,
            lifeMin: 0.15, lifeMax: 0.35,
            radiusMin: 1.2, radiusMax: 2.4,
          });
        }
        if (client.minimapBorderFlash) client.minimapBorderFlash(p4 ? 1.0 : 0.6);
      }
      if (p4) {
        // Floating "ENRAGED" banner above the boss — long life so
        // players have time to register the threshold change before
        // the silent dashes start landing.
        client.floatingTexts.push({
          x: evt.x, y: evt.y - 60, text: 'ENRAGED',
          color: '#ff5050', life: 1.6, maxLife: 1.6, vy: -32,
        });
      }
      break;
    }

    case 'bossSpawn':
      // Boss arrival — ominous sfx, big shake, deep red burst at
      // spawn so everyone knows where THE DEMON landed.
      sfx('boss_telegraph');
      shake(0.35);
      for (let i = 0; i < 24; i++) {
        pushFx(client.particles, evt.x, evt.y, '#d63031', {
          speedMin: 80, speedMax: 220,
          lifeMin: 0.5, lifeMax: 0.9,
          radiusMin: 2, radiusMax: 4,
        });
      }
      for (let i = 0; i < 8; i++) {
        pushFx(client.particles, evt.x, evt.y, '#7b1212', {
          speedMin: 30, speedMax: 100,
          lifeMin: 0.7, lifeMax: 1.1,
          radiusMin: 3, radiusMax: 5,
        });
      }
      break;

    case 'evolution':
      if (isMe) shake(0.5);
      spawn(evt.x, evt.y, '#f39c12', 20);
      break;

    case 'waveSurvived':
      if (client.onWaveSurvived) client.onWaveSurvived(evt);
      break;

    case 'consumableSpawn':
      // Rare drop — make it loud. Upward fountain + ring flash so
      // an off-screen player who pans over still notices it landed
      // (server gate keeps this rare; we don't have to be subtle).
      consumableSpawnFanfare(client.particles, evt);
      sfx('powerup');
      break;

    case 'consumablePickup': {
      if (isMe) sfx('powerup');
      // Label always floats up — same shape across types so the
      // text reads as a system-level pickup notification.
      client.floatingTexts.push({
        x: evt.x, y: evt.y,
        text: evt.label || (evt.ctype || '').toUpperCase(),
        color: evt.color || '#f39c12',
        life: 1.0, maxLife: 1.0, vy: -50,
      });
      // Per-type pickup burst — bomb explodes, shield rings out,
      // magnet pulls in. Picker also gets a flavor-fitting shake.
      consumablePickupBurst(client.particles, evt);
      if (isMe) {
        if (evt.ctype === 'bomb') shake(0.35);
        else if (evt.ctype === 'magnet') shake(0.08);
        else shake(0.12);
      }
      break;
    }

    case 'statusApplied': {
      // Light particle pop when a status lands — type-coded palette.
      // Kept small: chain/storm hits fire these repeatedly and would
      // overwhelm the screen if each burst were too large.
      const { statusType, x, y } = evt;
      if (statusType === 'burn') {
        // 3-5 orange embers rising from the enemy.
        const count = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          pushFx(client.particles, x, y, Math.random() < 0.6 ? '#e67e22' : '#f39c12', {
            speedMin: 20, speedMax: 60,
            lifeMin: 0.4, lifeMax: 0.7,
            radiusMin: 1.5, radiusMax: 2.5,
            biasY: -80,
          });
        }
      } else if (statusType === 'slow') {
        // 2-3 blue motes.
        const count = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) {
          pushFx(client.particles, x, y, '#74b9ff', {
            speedMin: 30, speedMax: 80,
            lifeMin: 0.3, lifeMax: 0.5,
            radiusMin: 1.5, radiusMax: 2.5,
          });
        }
      } else if (statusType === 'freeze') {
        // 4-6 white/cyan shards + a fat center flash.
        const count = 4 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          pushFx(client.particles, x, y, Math.random() < 0.5 ? '#dff9fb' : '#00cec9', {
            speedMin: 40, speedMax: 110,
            lifeMin: 0.3, lifeMax: 0.6,
            radiusMin: 1.5, radiusMax: 3,
          });
        }
        // Brief white core flash at impact point.
        pushFx(client.particles, x, y, '#ffffff', {
          speedMin: 0, speedMax: 5,
          lifeMin: 0.12, lifeMax: 0.18,
          radiusMin: 6, radiusMax: 9,
        });
      }
      break;
    }
  }
}
