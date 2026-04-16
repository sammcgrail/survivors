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

// Muzzle/cast flash color pairs per weapon. Evolution entries pick hues
// keyed off their source pair so the glow tells you *what* maxed, not
// just that it did — e.g. tesla_aegis (chain + shield) reads as white-
// blue electric, meteor_orbit (orbit + meteor) reads as red-flame blade.
// Weapons not listed (breath/orbit/shield — aura types with no discrete
// "shot") skip the muzzle flash entirely.
const MUZZLE_STYLES = {
  spit:          { bright: '#d6a0f5', trail: '#8e44ad' }, // base purple
  chain:         { bright: '#b7ebff', trail: '#0099cc' }, // base cyan
  dragon_storm:  { bright: '#ffd27f', trail: '#e67e22' }, // spit+breath  — amber/orange
  thunder_god:   { bright: '#e0fdff', trail: '#ffdd66' }, // chain+field  — cyan w/ gold core
  meteor_orbit:  { bright: '#fff2b0', trail: '#ff6b35' }, // orbit+meteor — white-flame blade
  fortress:      { bright: '#e8f4ff', trail: '#ff6363' }, // shield+charge — ice-blue w/ shock red
  inferno_wheel: { bright: '#ffce66', trail: '#ff4500' }, // breath+orbit — blazing amber
  void_anchor:   { bright: '#c8b6ff', trail: '#6c5ce7' }, // meteor+chain — dark violet gravity
  tesla_aegis:   { bright: '#d4f1ff', trail: '#0099cc' }, // chain+shield — electric white-blue
};

// Evolved weapons get an upgraded cast bloom: more bright particles, a
// longer trail, and an 8-particle outward halo ring so the fire frame
// reads visibly "tier-max" vs the base weapons. Membership is cheap to
// check — O(1) object lookup in the hot path.
const EVOLVED_WEAPONS = {
  dragon_storm: true, thunder_god: true, meteor_orbit: true,
  fortress: true, inferno_wheel: true, void_anchor: true, tesla_aegis: true,
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
      // MEATY CHUNK SHARDS — chunky irregular debris with heavy biasY
      // so it reads as solid matter falling out. Big radii, slower
      // motion, long life. The white-hot core + lingering embers
      // from the previous version stay to keep the violent punch.
      // Layer 1 — 14 chunky shards. Big, slow-ish, gravity-pulled.
      for (let i = 0; i < 14; i++) {
        pushFx(particles, x, y, color, {
          speedMin: 110, speedMax: 230,
          lifeMin: 0.45, lifeMax: 0.85,
          radiusMin: 3.5, radiusMax: 6,
          biasY: 140,
        });
      }
      // Layer 2 — dark-meat gore chunks (even bigger, heavier).
      for (let i = 0; i < 8; i++) {
        pushFx(particles, x, y, '#7b1212', {
          speedMin: 80, speedMax: 170,
          lifeMin: 0.6, lifeMax: 1.0,
          radiusMin: 4, radiusMax: 6.5,
          biasY: 180,
        });
      }
      // Layer 3 — white-hot core sparks (kept from prior version).
      for (let i = 0; i < 8; i++) {
        pushFx(particles, x, y, '#ffffff', {
          speedMin: 220, speedMax: 360,
          lifeMin: 0.12, lifeMax: 0.25,
          radiusMin: 1, radiusMax: 2,
        });
      }
      break;
    }

    case 'elite': {
      // VIOLET SOUL-WISP — elite ascending. Drop the burst-radial
      // shape entirely; do slow upward-drifting violet wisps + a
      // brief white-violet flash at the body.
      // Layer 1 — 14 slow violet wisps rising with slight sway.
      for (let i = 0; i < 14; i++) {
        pushFx(particles, x, y, '#9b59b6', {
          speedMin: 30, speedMax: 70,
          lifeMin: 0.7, lifeMax: 1.1,
          radiusMin: 2, radiusMax: 3.5,
          biasY: -110,
        });
      }
      // Layer 2 — lighter violet drift, mid-life.
      for (let i = 0; i < 8; i++) {
        pushFx(particles, x, y, '#d6a0f5', {
          speedMin: 20, speedMax: 60,
          lifeMin: 0.5, lifeMax: 0.9,
          radiusMin: 1.6, radiusMax: 2.6,
          biasY: -80,
        });
      }
      // Layer 3 — brief white-violet flash at the body (fast, tiny).
      for (let i = 0; i < 6; i++) {
        pushFx(particles, x, y, '#ffffff', {
          speedMin: 60, speedMax: 140,
          lifeMin: 0.08, lifeMax: 0.15,
          radiusMin: 1, radiusMax: 1.8,
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
      // 2-STAGE IMPLOSION.
      // Stage 1 (collapse): 28 particles spawn on an outer ring at
      // ~90u and move INWARD at high speed, arriving at center in
      // ~0.2s. Reads as the boss collapsing on itself — same grammar
      // as evolution stage 1 (PR #111), amped for scale.
      for (let i = 0; i < 28; i++) {
        const a = (Math.PI * 2 * i) / 28 + Math.random() * 0.15;
        const r0 = 80 + Math.random() * 30;
        const inward = 380 + Math.random() * 100;
        particles.push({
          x: x + Math.cos(a) * r0,
          y: y + Math.sin(a) * r0,
          vx: -Math.cos(a) * inward,
          vy: -Math.sin(a) * inward,
          life: 0.22, maxLife: 0.22,
          radius: 2.2 + Math.random(),
          color,
        });
      }
      // Stage 2 (shockwave ring): 36 particles on a tighter center
      // ring expanding OUTWARD at max speed. Staggered fast/slow so
      // the ring reads as a coherent shockwave front rather than a
      // generic radial burst.
      for (let i = 0; i < 36; i++) {
        const a = (Math.PI * 2 * i) / 36 + Math.random() * 0.08;
        const shock = 260 + Math.random() * 180;
        particles.push({
          x, y,
          vx: Math.cos(a) * shock,
          vy: Math.sin(a) * shock,
          life: 0.4, maxLife: 0.4,
          radius: 2.4 + Math.random() * 1.8,
          color: '#ffffff',
        });
      }
      // Core flash — brief bright pop at collapse moment.
      for (let i = 0; i < 10; i++) {
        pushFx(particles, x, y, '#ffffff', {
          speedMin: 30, speedMax: 90,
          lifeMin: 0.1, lifeMax: 0.18,
          radiusMin: 4, radiusMax: 6.5,
        });
      }
      // Layer 4 — chunky dark debris that lingers and falls (kept
      // from prior finale so the arena has aftermath to read).
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
      // Inward spiral: 6 blue motes spawn on a 16u ring and converge
      // on the pickup point, arriving in ~0.12s. Reads as "gem
      // absorbed into you" instead of a radial puff going the wrong
      // direction. Tier-2 pickups (boss/elite gems) get the same
      // shape with brighter gold, matching the minimap color coding.
      {
        const tier2 = (evt.xp || 0) >= 80;
        const core = tier2 ? '#f1c40f' : '#5dade2';
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6 + Math.random() * 0.25;
          const r0 = 14 + Math.random() * 6;
          const inward = 140 + Math.random() * 40;
          client.particles.push({
            x: evt.x + Math.cos(a) * r0,
            y: evt.y + Math.sin(a) * r0,
            vx: -Math.cos(a) * inward,
            vy: -Math.sin(a) * inward,
            life: 0.14, maxLife: 0.14,
            radius: 1.4 + Math.random() * 0.5,
            color: core,
          });
        }
      }
      break;

    case 'heartPickup':
      if (isMe) sfx('heal');
      if (evt.healed > 0) {
        client.floatingTexts.push({
          x: evt.x, y: evt.y, text: '+' + Math.floor(evt.healed) + ' HP',
          color: '#2ecc71', life: 0.8, maxLife: 0.8, vy: -50,
        });
      }
      // Inward spiral (green/red mix) — same grammar as gem pickup so
      // pickups across the game share one visual vocabulary.
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * 2 * i) / 6 + Math.random() * 0.25;
        const r0 = 14 + Math.random() * 6;
        const inward = 130 + Math.random() * 40;
        client.particles.push({
          x: evt.x + Math.cos(a) * r0,
          y: evt.y + Math.sin(a) * r0,
          vx: -Math.cos(a) * inward,
          vy: -Math.sin(a) * inward,
          life: 0.15, maxLife: 0.15,
          radius: 1.4 + Math.random() * 0.5,
          color: i % 2 === 0 ? '#2ecc71' : '#e74c3c',
        });
      }
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
      // Overkill punch-frame — fires when sim flagged this kill as
      // 3x+ pre-hit hp (threat-tier or 50+ dmg only — gated sim-side
      // so trash spit-kills don't spam). Short bright white overlay
      // + bonus sparks at the kill site for extra kinetic punch.
      if (evt.overkill && killedIt) {
        flash(0.28);
        // 10 bonus high-speed white sparks radiating out, fast + tiny.
        for (let i = 0; i < 10; i++) {
          pushFx(client.particles, evt.x, evt.y, '#ffffff', {
            speedMin: 280, speedMax: 460,
            lifeMin: 0.12, lifeMax: 0.22,
            radiusMin: 1.4, radiusMax: 2.6,
          });
        }
        // 6 yellow core afterglow particles, slightly longer-lived,
        // so the punch-frame doesn't end clean-cold.
        for (let i = 0; i < 6; i++) {
          pushFx(client.particles, evt.x, evt.y, '#ffe066', {
            speedMin: 100, speedMax: 200,
            lifeMin: 0.25, lifeMax: 0.4,
            radiusMin: 1.6, radiusMax: 2.4,
          });
        }
      }
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
      // Muzzle/cast flash — short bloom at the fire origin so every shot
      // has a kinetic starting frame. Base weapons get 5 bright + 2 trail.
      // Evolved weapons get a tier bump: 7 bright + 3 trail + an outward
      // 8-particle halo ring at fixed speed so level-1 kits visibly read
      // different from max-tier ones at the cast frame.
      if (evt.x !== undefined && evt.y !== undefined) {
        const style = MUZZLE_STYLES[evt.weapon];
        if (style) {
          const evolved = EVOLVED_WEAPONS[evt.weapon];
          const brightCount = evolved ? 7 : 5;
          const trailCount = evolved ? 3 : 2;
          for (let i = 0; i < brightCount; i++) {
            pushFx(client.particles, evt.x, evt.y, style.bright, {
              speedMin: 120, speedMax: 220,
              lifeMin: 0.1, lifeMax: 0.18,
              radiusMin: 1.3, radiusMax: 2.4,
            });
          }
          for (let i = 0; i < trailCount; i++) {
            pushFx(client.particles, evt.x, evt.y, style.trail, {
              speedMin: 40, speedMax: 80,
              lifeMin: 0.25, lifeMax: 0.45,
              radiusMin: 0.9, radiusMax: 1.5,
            });
          }
          if (evolved) {
            // Halo ring — 8 bright motes pushed outward at equal angles
            // and matched speed so they read as an expanding ring, not a
            // random burst. Short life keeps it from lingering into the
            // next fire.
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              pushFx(client.particles, evt.x, evt.y, style.bright, {
                angle: a,
                speedMin: 180, speedMax: 180,
                lifeMin: 0.22, lifeMax: 0.22,
                radiusMin: 1.2, radiusMax: 1.2,
              });
            }
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
      if (evt.source === 'healer') {
        // Healer pulse — translucent green ring expanding out to the
        // heal reach, plus a few inner motes. Priority-target cue:
        // players need to SEE the heal radius so they can learn to
        // kill healers first. `radius` comes from the sim (not
        // hard-coded) so stacking sizeMulti would scale the visual.
        const r = evt.radius || 140;
        // Ring — 22 particles on a circle, life tied to ring's visible
        // expansion window. Motion vector is 0 so the ring stays on
        // the circle; particle fade handles the pulse feel.
        for (let i = 0; i < 22; i++) {
          const a = (Math.PI * 2 * i) / 22;
          client.particles.push({
            x: evt.x + Math.cos(a) * r,
            y: evt.y + Math.sin(a) * r,
            vx: Math.cos(a) * 80,
            vy: Math.sin(a) * 80,
            life: 0.45, maxLife: 0.45,
            radius: 2 + Math.random(),
            color: '#a7f3c4',
          });
        }
        // Inner center glow — 4 motes rising slowly.
        for (let i = 0; i < 4; i++) {
          pushFx(client.particles, evt.x, evt.y, '#00b894', {
            speedMin: 20, speedMax: 60,
            lifeMin: 0.5, lifeMax: 0.8,
            radiusMin: 1.8, radiusMax: 2.8,
            biasY: -40,
          });
        }
        sfx('heal');
      } else {
        spawn(evt.x, evt.y, '#fdcb6e', 8);
        sfx('hive_burst');
      }
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
      //             crimson burst with "ENRAGED" floating banner
      //   phase 5 → FINAL FORM — everything maxed, black-red burst,
      //             "FINAL FORM" banner, longest minimap pulse
      const phase = evt.phase || 2;
      const p5 = phase === 5;
      const p4 = phase === 4;
      const p3 = phase === 3;
      shake(p5 ? 0.8 : p4 ? 0.5 : p3 ? 0.25 : 0.15);
      flash(p5 ? 0.6 : p4 ? 0.4 : p3 ? 0.20 : 0.12);
      sfx(p4 || p5 ? 'boss_step' : 'boss_telegraph');
      const burstColor = p5 ? '#1a0000' : p4 ? '#ff2424' : p3 ? '#7b1212' : '#e17055';
      const burstCount = p5 ? 80 : p4 ? 56 : p3 ? 32 : 20;
      for (let i = 0; i < burstCount; i++) {
        pushFx(client.particles, evt.x, evt.y, burstColor, {
          speedMin: p5 ? 180 : p4 ? 140 : 100,
          speedMax: p5 ? 500 : p4 ? 380 : 300,
          lifeMin: 0.4, lifeMax: 0.9,
          radiusMin: 2, radiusMax: p5 ? 7 : p4 ? 5.5 : 4.5,
        });
      }
      if (p3 || p4 || p5) {
        // White-hot sparks scale with phase intensity.
        const sparks = p5 ? 40 : p4 ? 24 : 12;
        for (let i = 0; i < sparks; i++) {
          pushFx(client.particles, evt.x, evt.y, '#ffffff', {
            speedMin: 200, speedMax: p5 ? 600 : 450,
            lifeMin: 0.15, lifeMax: 0.35,
            radiusMin: 1.2, radiusMax: 2.4,
          });
        }
        if (client.minimapBorderFlash) client.minimapBorderFlash(p5 ? 2.0 : p4 ? 1.0 : 0.6);
      }
      if (p4) {
        client.floatingTexts.push({
          x: evt.x, y: evt.y - 60, text: 'ENRAGED',
          color: '#ff5050', life: 1.6, maxLife: 1.6, vy: -32,
        });
      }
      if (p5) {
        client.floatingTexts.push({
          x: evt.x, y: evt.y - 60, text: 'FINAL FORM',
          color: '#ff0000', life: 2.2, maxLife: 2.2, vy: -32,
        });
      }
      break;
    }

    case 'bossSpawn':
      // Boss arrival — 3-stage so it reads as a real moment, not a
      // single puff. Stage 1: ground dust rings outward (near-black
      // debris at low speed, long life) — "something heavy just
      // landed." Stage 2: crimson eruption outward (existing shape).
      // Stage 3: slow embers rising — lingering aftermath.
      sfx('boss_telegraph');
      shake(0.45);
      flash(0.08);
      // Stage 1 — inward-converging debris ring. Particles start on a
      // 60-100u circle moving toward center, arriving ~0.15s later as
      // the center erupts. Reads as "ground cracking inward."
      for (let i = 0; i < 14; i++) {
        const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.3;
        const r0 = 60 + Math.random() * 40;
        const inward = 280 + Math.random() * 80;
        client.particles.push({
          x: evt.x + Math.cos(a) * r0,
          y: evt.y + Math.sin(a) * r0,
          vx: -Math.cos(a) * inward,
          vy: -Math.sin(a) * inward,
          life: 0.22, maxLife: 0.22,
          radius: 2 + Math.random() * 1.5,
          color: '#3a1010',
        });
      }
      // Stage 2 — crimson erupt outward (existing shape).
      for (let i = 0; i < 24; i++) {
        pushFx(client.particles, evt.x, evt.y, '#d63031', {
          speedMin: 120, speedMax: 260,
          lifeMin: 0.5, lifeMax: 0.9,
          radiusMin: 2, radiusMax: 4,
        });
      }
      // Stage 3 — slow rising embers (upward bias via negative vy).
      for (let i = 0; i < 10; i++) {
        const vx = (Math.random() - 0.5) * 50;
        const vy = -30 - Math.random() * 60;
        client.particles.push({
          x: evt.x + (Math.random() - 0.5) * 30,
          y: evt.y + (Math.random() - 0.5) * 20,
          vx, vy,
          life: 0.9, maxLife: 0.9,
          radius: 2 + Math.random() * 2.5,
          color: Math.random() < 0.5 ? '#f39c12' : '#7b1212',
        });
      }
      break;

    case 'bossTeleport': {
      // Arrival burst at the new position. Departure is already covered
      // by the METEOR_WARN damage zone left at the old position — client
      // sees the warn ring there and the arrival bloom here.
      for (let i = 0; i < 20; i++) {
        pushFx(client.particles, evt.toX, evt.toY, '#6c0000', {
          speedMin: 80, speedMax: 240,
          lifeMin: 0.2, lifeMax: 0.5,
          radiusMin: 2, radiusMax: 4.5,
        });
      }
      for (let i = 0; i < 8; i++) {
        pushFx(client.particles, evt.toX, evt.toY, '#ffffff', {
          speedMin: 150, speedMax: 340,
          lifeMin: 0.1, lifeMax: 0.2,
          radiusMin: 1, radiusMax: 2.2,
        });
      }
      sfx('boss_telegraph');
      break;
    }

    case 'bossResurrect': {
      // The single biggest moment in the fight — boss comes back from 0.
      // Max shake, near-full flash, 100-particle eruption + sparks +
      // 3s minimap border + RESURRECTED banner. Players who haven't seen
      // phase 5 should feel genuinely surprised.
      shake(1.2);
      flash(0.9);
      sfx('boss_step');
      for (let i = 0; i < 100; i++) {
        pushFx(client.particles, evt.x, evt.y, '#8b0000', {
          speedMin: 200, speedMax: 600,
          lifeMin: 0.5, lifeMax: 1.2,
          radiusMin: 3, radiusMax: 8,
        });
      }
      for (let i = 0; i < 50; i++) {
        pushFx(client.particles, evt.x, evt.y, '#ffffff', {
          speedMin: 300, speedMax: 700,
          lifeMin: 0.15, lifeMax: 0.4,
          radiusMin: 1, radiusMax: 3,
        });
      }
      if (client.minimapBorderFlash) client.minimapBorderFlash(3.0);
      client.floatingTexts.push({
        x: evt.x, y: evt.y - 60, text: 'RESURRECTED',
        color: '#ff0000', life: 2.5, maxLife: 2.5, vy: -28,
      });
      break;
    }

    case 'bossAoeWarn': {
      // Arena-wide nova incoming — tell players where the safe corner is.
      // Shake + sfx for urgency; "RUN!" banner above the boss; green
      // particle ring + "SAFE ZONE" text at the safe corner so players
      // know exactly where to go, even mid-panic.
      shake(0.25);
      sfx('boss_telegraph');
      client.floatingTexts.push({
        x: evt.x, y: evt.y - 80, text: 'RUN!',
        color: '#ff4040', life: evt.warnDuration || 2.5,
        maxLife: evt.warnDuration || 2.5, vy: -18,
      });
      if (evt.safeX !== undefined && evt.safeY !== undefined) {
        const r = evt.safeRadius || 280;
        for (let i = 0; i < 20; i++) {
          const angle = (Math.PI * 2 * i) / 20;
          client.particles.push({
            x: evt.safeX + Math.cos(angle) * r,
            y: evt.safeY + Math.sin(angle) * r,
            vx: 0, vy: -15,
            life: evt.warnDuration || 2.5, maxLife: evt.warnDuration || 2.5,
            color: '#00ff88', radius: 4,
          });
        }
        client.floatingTexts.push({
          x: evt.safeX, y: evt.safeY, text: 'SAFE ZONE',
          color: '#00ff88', life: evt.warnDuration || 2.5,
          maxLife: evt.warnDuration || 2.5, vy: -10,
        });
      }
      break;
    }

    case 'bossAoeExplode': {
      // Nova detonation — everything outside the safe zone just got hit.
      shake(0.6);
      flash(0.35);
      sfx('boss_step');
      for (let i = 0; i < 40; i++) {
        pushFx(client.particles, evt.x, evt.y, '#8b0000', {
          speedMin: 150, speedMax: 500,
          lifeMin: 0.4, lifeMax: 1.0,
          radiusMin: 3, radiusMax: 7,
        });
      }
      break;
    }

    case 'evolution':
      // Evolution — 3-stage: (1) inward-sucking source particles
      // converging on the center, (2) bright outward flash bloom,
      // (3) lingering gold aura orbit around the player. Reads as
      // "power gathers → explodes outward → settles into a glow"
      // instead of a single 20-particle puff.
      if (isMe) { shake(0.5); flash(0.2); }
      // Stage 1 — 16 gold motes converging inward from a ring at ~60u.
      for (let i = 0; i < 16; i++) {
        const a = (Math.PI * 2 * i) / 16 + Math.random() * 0.2;
        const r0 = 55 + Math.random() * 25;
        const inward = 300 + Math.random() * 80;
        client.particles.push({
          x: evt.x + Math.cos(a) * r0,
          y: evt.y + Math.sin(a) * r0,
          vx: -Math.cos(a) * inward,
          vy: -Math.sin(a) * inward,
          life: 0.2, maxLife: 0.2,
          radius: 1.8 + Math.random(),
          color: '#ffd27f',
        });
      }
      // Stage 2 — big bright outward bloom at center.
      for (let i = 0; i < 24; i++) {
        pushFx(client.particles, evt.x, evt.y, '#ffd27f', {
          speedMin: 180, speedMax: 340,
          lifeMin: 0.25, lifeMax: 0.45,
          radiusMin: 2, radiusMax: 3.5,
        });
      }
      for (let i = 0; i < 8; i++) {
        pushFx(client.particles, evt.x, evt.y, '#ffffff', {
          speedMin: 120, speedMax: 260,
          lifeMin: 0.15, lifeMax: 0.3,
          radiusMin: 1.4, radiusMax: 2.4,
        });
      }
      // Stage 3 — lingering gold embers that orbit outward slowly and
      // fade over ~1.2s, so the player visibly glows for a moment
      // after the bloom.
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 50;
        client.particles.push({
          x: evt.x,
          y: evt.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: 1.0 + Math.random() * 0.3,
          maxLife: 1.2,
          radius: 1.6 + Math.random() * 1.2,
          color: '#f39c12',
        });
      }
      break;

    case 'waveSurvived':
      if (client.onWaveSurvived) client.onWaveSurvived(evt);
      break;

    case 'consumableSpawn':
      // Rare drop — 3-stage: (1) sky beam converging down onto the
      // landing point, (2) ring slam + upward fountain (existing
      // fanfare), (3) lingering halo that fades slowly so the drop
      // stays visually findable for ~1s after landing.
      sfx('powerup');
      // Stage 1 — beam of light from above. Particles spawn at the
      // drop location + a column extending up, falling downward in
      // sequence so the eye reads a descending beam.
      for (let i = 0; i < 14; i++) {
        const t = i / 14;
        const py = evt.y - 140 + t * 140;
        client.particles.push({
          x: evt.x + (Math.random() - 0.5) * 14,
          y: py,
          vx: (Math.random() - 0.5) * 30,
          vy: 280 + Math.random() * 60,
          life: 0.22 + Math.random() * 0.1,
          maxLife: 0.32,
          radius: 1.8 + Math.random(),
          color: evt.color || '#f39c12',
        });
      }
      // Stage 2 — the existing fanfare (ring + upward fountain).
      consumableSpawnFanfare(client.particles, evt);
      // Stage 3 — soft lingering halo. Slow orbit motion + long life
      // so the drop keeps glowing while it sits on the ground.
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10;
        const r0 = 22;
        const tangent = 40;
        client.particles.push({
          x: evt.x + Math.cos(a) * r0,
          y: evt.y + Math.sin(a) * r0,
          vx: -Math.sin(a) * tangent,
          vy: Math.cos(a) * tangent,
          life: 0.9, maxLife: 0.9,
          radius: 1.4 + Math.random(),
          color: evt.color || '#f39c12',
        });
      }
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

    case 'statusExpired': {
      // Status wears off — one-time expiry VFX that closes the loop so
      // players register "that enemy just stopped being frozen" even
      // when they're looking elsewhere on screen. Small + fast; no
      // screen shake, no sfx (too spammy at high enemy counts).
      const { statusType, x, y } = evt;
      if (statusType === 'freeze') {
        // Ice shatter — 6 bright shards flying outward + a quick ring.
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
          const speed = 90 + Math.random() * 110;
          client.particles.push({
            x, y,
            vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
            life: 0.3, maxLife: 0.3,
            radius: 1.8 + Math.random(),
            color: Math.random() < 0.5 ? '#e6f5fb' : '#74b9ff',
          });
        }
      } else if (statusType === 'burn') {
        // Smoke dissipation — 4 dark particles drifting up + fading.
        for (let i = 0; i < 4; i++) {
          client.particles.push({
            x: x + (Math.random() - 0.5) * 8,
            y: y + (Math.random() - 0.5) * 4,
            vx: (Math.random() - 0.5) * 25,
            vy: -50 - Math.random() * 30,
            life: 0.5, maxLife: 0.5,
            radius: 2 + Math.random() * 1.5,
            color: '#4a3020',
          });
        }
      } else if (statusType === 'slow') {
        // Chill ripple — 8 small blue motes orbiting outward over 0.3s,
        // reads as "the cold wearing off."
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI * 2 * i) / 8;
          const speed = 60;
          client.particles.push({
            x, y,
            vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
            life: 0.28, maxLife: 0.28,
            radius: 1.3,
            color: '#74b9ff',
          });
        }
      }
      break;
    }
  }
}
