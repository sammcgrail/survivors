(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/shared/sprites.js
  var SPRITE_SIZE, SP;
  var init_sprites = __esm({
    "src/shared/sprites.js"() {
      SPRITE_SIZE = 16;
      SP = {
        player: [0, 0],
        blob: [1, 0],
        fast: [2, 0],
        tank: [3, 0],
        swarm: [4, 0],
        gem: [5, 0],
        heart: [6, 0],
        crate: [7, 0],
        spit: [0, 1],
        spitTrail: [1, 1],
        flame: [2, 1],
        chargeSpark: [3, 1],
        explosion: [4, 1],
        skull: [5, 1],
        shield: [6, 1],
        magnet: [7, 1],
        boss: [0, 2],
        brute: [1, 2],
        elite: [2, 2],
        spawner: [3, 2]
      };
    }
  });

  // src/shared/constants.js
  var WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_RADIUS, PLAYER_MAX_HP, XP_RADIUS, XP_MAGNET_RANGE, XP_MAGNET_SPEED;
  var init_constants = __esm({
    "src/shared/constants.js"() {
      WORLD_W = 3e3;
      WORLD_H = 3e3;
      PLAYER_SPEED = 150;
      PLAYER_RADIUS = 14;
      PLAYER_MAX_HP = 100;
      XP_RADIUS = 6;
      XP_MAGNET_RANGE = 80;
      XP_MAGNET_SPEED = 400;
    }
  });

  // src/shared/weapons.js
  function createWeapon(type) {
    switch (type) {
      case "spit":
        return {
          type: "spit",
          cooldown: 0.8,
          timer: 0,
          damage: 15,
          speed: 350,
          range: 300,
          count: 1,
          pierce: 1,
          color: "#9b59b6"
        };
      case "breath":
        return {
          type: "breath",
          cooldown: 0.5,
          timer: 0,
          damage: 8,
          radius: 80,
          color: "#e67e22",
          pulsePhase: 0
        };
      case "charge":
        return {
          type: "charge",
          cooldown: 2.5,
          timer: 0,
          damage: 40,
          speed: 500,
          duration: 0.3,
          width: 40,
          color: "#e74c3c",
          active: false,
          chargeTimer: 0,
          chargeDx: 0,
          chargeDy: 0
        };
      case "orbit":
        return {
          type: "orbit",
          cooldown: 0,
          timer: 0,
          damage: 12,
          radius: 70,
          bladeCount: 2,
          rotSpeed: 3,
          color: "#ecf0f1",
          phase: 0
        };
      case "chain":
        return {
          type: "chain",
          cooldown: 1.2,
          timer: 0,
          damage: 20,
          range: 250,
          chainRange: 120,
          chains: 2,
          color: "#00d2d3"
        };
      case "meteor":
        return {
          type: "meteor",
          cooldown: 3.5,
          timer: 0,
          damage: 50,
          blastRadius: 60,
          color: "#ff6348"
        };
      case "shield":
        return {
          type: "shield",
          cooldown: 99999,
          timer: 99999,
          damage: 20,
          radius: 50,
          color: "#74b9ff",
          knockback: 200,
          phase: 0
        };
      case "lightning_field":
        return {
          type: "lightning_field",
          cooldown: 0.6,
          timer: 0,
          damage: 18,
          radius: 140,
          color: "#ffeaa7",
          zapCount: 3
        };
      case "dragon_storm":
        return {
          type: "dragon_storm",
          cooldown: 0.4,
          timer: 0,
          damage: 25,
          speed: 300,
          range: 350,
          count: 3,
          pierce: 3,
          color: "#f39c12",
          auraRadius: 100,
          auraDamage: 15
        };
      default:
        return null;
    }
  }
  var WEAPON_ICONS;
  var init_weapons = __esm({
    "src/shared/weapons.js"() {
      WEAPON_ICONS = {
        spit: "\u{1F52E}",
        breath: "\u{1F300}",
        charge: "\u{1F402}",
        orbit: "\u{1F5E1}\uFE0F",
        chain: "\u26A1",
        meteor: "\u2604\uFE0F",
        shield: "\u{1F6E1}\uFE0F",
        lightning_field: "\u26A1",
        dragon_storm: "\u{1F409}"
      };
    }
  });

  // src/shared/enemyTypes.js
  function enemyType(wave) {
    const special = SPECIAL_WAVES[wave];
    if (special && special.override) {
      const base = ENEMY_TYPES.find((t) => t.name === special.override);
      return scaleEnemy(base, wave);
    }
    const pool = WAVE_POOLS.find((p) => wave <= p.maxWave) || WAVE_POOLS[WAVE_POOLS.length - 1];
    const entries = Object.entries(pool.weights);
    const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
    let roll = Math.random() * totalWeight;
    for (const [name, weight] of entries) {
      roll -= weight;
      if (roll <= 0) {
        const base = ENEMY_TYPES.find((t) => t.name === name);
        return scaleEnemy(base, wave);
      }
    }
    return scaleEnemy(ENEMY_TYPES[0], wave);
  }
  function scaleEnemy(base, wave) {
    const hpScale = 1 + (wave - 1) * 0.12 + Math.max(0, wave - 8) * 0.08;
    const speedScale = 1 + (wave - 1) * 0.03;
    const dmgScale = 1 + (wave - 1) * 0.1;
    const xpScale = hpScale * 0.9;
    return {
      ...base,
      hp: Math.floor(base.hp * hpScale),
      maxHp: Math.floor(base.hp * hpScale),
      speed: base.speed * speedScale,
      damage: Math.floor(base.damage * dmgScale),
      xp: Math.floor(base.xp * xpScale),
      hitFlash: 0,
      orbitSign: Math.random() < 0.5 ? 1 : -1,
      spawnTimer: base.name === "spawner" ? 2 + Math.random() * 2 : 0
      // spawners birth swarms
    };
  }
  var ENEMY_TYPES, WAVE_POOLS, SPECIAL_WAVES;
  var init_enemyTypes = __esm({
    "src/shared/enemyTypes.js"() {
      ENEMY_TYPES = [
        { name: "blob", hp: 20, speed: 55, radius: 10, color: "#2ecc71", damage: 8, xp: 10, sprite: "blob" },
        { name: "fast", hp: 10, speed: 130, radius: 7, color: "#1abc9c", damage: 4, xp: 8, sprite: "fast" },
        { name: "tank", hp: 80, speed: 30, radius: 18, color: "#e67e22", damage: 18, xp: 30, sprite: "tank" },
        { name: "swarm", hp: 6, speed: 85, radius: 5, color: "#fd79a8", damage: 2, xp: 4, sprite: "swarm" },
        { name: "brute", hp: 150, speed: 22, radius: 24, color: "#e74c3c", damage: 30, xp: 60, sprite: "brute" },
        { name: "ghost", hp: 15, speed: 100, radius: 9, color: "#a29bfe", damage: 6, xp: 12, sprite: "skull" },
        { name: "elite", hp: 300, speed: 45, radius: 20, color: "#6c5ce7", damage: 25, xp: 80, sprite: "elite" },
        { name: "spawner", hp: 100, speed: 15, radius: 22, color: "#fdcb6e", damage: 10, xp: 50, sprite: "spawner" },
        { name: "boss", hp: 2e3, speed: 35, radius: 40, color: "#d63031", damage: 50, xp: 500, sprite: "boss" }
      ];
      WAVE_POOLS = [
        { maxWave: 2, weights: { blob: 5, swarm: 3 } },
        { maxWave: 4, weights: { blob: 4, swarm: 4, fast: 2 } },
        { maxWave: 6, weights: { blob: 3, swarm: 3, fast: 3, tank: 1 } },
        { maxWave: 9, weights: { blob: 2, swarm: 4, fast: 3, tank: 2, ghost: 2 } },
        { maxWave: 12, weights: { blob: 1, swarm: 5, fast: 3, tank: 3, ghost: 2, brute: 1 } },
        { maxWave: 17, weights: { blob: 1, swarm: 6, fast: 4, tank: 3, ghost: 3, brute: 2 } },
        { maxWave: 999, weights: { swarm: 5, fast: 4, tank: 3, ghost: 4, brute: 3, elite: 1, spawner: 1 } }
      ];
      SPECIAL_WAVES = {
        6: { name: "SWARM RUSH", override: "swarm", countMulti: 3 },
        7: { name: "PHANTOM", override: "ghost", countMulti: 0.5 },
        // teach: few ghosts
        9: { name: "TANK PARADE", override: "tank", countMulti: 1.5 },
        11: { name: "GHOST STORM", override: "ghost", countMulti: 1.5 },
        13: { name: "BRUTE FORCE", override: "brute", countMulti: 1 },
        15: { name: "THE HORDE", override: null, countMulti: 4 },
        17: { name: "ELITE GUARD", override: "elite", countMulti: 0.5 },
        19: { name: "HIVE MIND", override: "spawner", countMulti: 0.8 },
        20: { name: "THE DEMON", override: "boss", countMulti: 0.05 }
        // single boss
      };
    }
  });

  // src/main.js
  var require_main = __commonJS({
    "src/main.js"() {
      init_sprites();
      init_constants();
      init_weapons();
      init_enemyTypes();
      var canvas = document.getElementById("c");
      var ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      var hudEl = {
        time: document.getElementById("hud-time"),
        level: document.getElementById("hud-level"),
        kills: document.getElementById("hud-kills"),
        wave: document.getElementById("hud-wave"),
        weapons: document.getElementById("hud-weapons"),
        xpFill: document.getElementById("xp-fill")
      };
      var hudCache = { time: "", level: "", kills: "", wave: "", weapons: "", xpPct: -1 };
      function setHud(key, str) {
        if (str !== hudCache[key]) {
          hudEl[key].textContent = str;
          hudCache[key] = str;
        }
      }
      var spriteSheet = new Image();
      spriteSheet.src = "sprites.png";
      var spritesReady = false;
      spriteSheet.onload = () => {
        spritesReady = true;
      };
      function drawSprite(name, x, y, scale, alpha) {
        if (!spritesReady || !SP[name]) return false;
        const sp = SP[name];
        const s = SPRITE_SIZE;
        const drawSize = s * (scale || 2);
        const half = drawSize * 0.5;
        if (alpha !== void 0) {
          const prev = ctx.globalAlpha;
          ctx.globalAlpha = alpha;
          ctx.drawImage(spriteSheet, sp[0] * s, sp[1] * s, s, s, x - half, y - half, drawSize, drawSize);
          ctx.globalAlpha = prev;
        } else {
          ctx.drawImage(spriteSheet, sp[0] * s, sp[1] * s, s, s, x - half, y - half, drawSize, drawSize);
        }
        return true;
      }
      var audioCtx = null;
      function getAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
      }
      function sfx(type) {
        try {
          const ac = getAudio();
          const t = ac.currentTime;
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.connect(gain);
          gain.connect(ac.destination);
          switch (type) {
            case "hit":
              osc.type = "square";
              osc.frequency.setValueAtTime(220, t);
              osc.frequency.linearRampToValueAtTime(110, t + 0.06);
              gain.gain.setValueAtTime(0.08, t);
              gain.gain.linearRampToValueAtTime(0, t + 0.06);
              osc.start(t);
              osc.stop(t + 0.06);
              break;
            case "kill":
              osc.type = "sine";
              osc.frequency.setValueAtTime(400, t);
              osc.frequency.linearRampToValueAtTime(800, t + 0.08);
              gain.gain.setValueAtTime(0.12, t);
              gain.gain.linearRampToValueAtTime(0, t + 0.1);
              osc.start(t);
              osc.stop(t + 0.1);
              break;
            case "xp":
              osc.type = "sine";
              osc.frequency.setValueAtTime(880, t);
              osc.frequency.linearRampToValueAtTime(1320, t + 0.06);
              gain.gain.setValueAtTime(0.06, t);
              gain.gain.linearRampToValueAtTime(0, t + 0.08);
              osc.start(t);
              osc.stop(t + 0.08);
              break;
            case "levelup": {
              gain.gain.setValueAtTime(0, t);
              osc.start(t);
              osc.stop(t + 0.01);
              const notes = [523, 659, 784, 1047];
              notes.forEach((freq, i) => {
                const o = ac.createOscillator();
                const g = ac.createGain();
                o.connect(g);
                g.connect(ac.destination);
                o.type = "triangle";
                o.frequency.setValueAtTime(freq, t + i * 0.08);
                g.gain.setValueAtTime(0.1, t + i * 0.08);
                g.gain.linearRampToValueAtTime(0, t + i * 0.08 + 0.12);
                o.start(t + i * 0.08);
                o.stop(t + i * 0.08 + 0.12);
              });
              break;
            }
            case "playerhit":
              osc.type = "sawtooth";
              osc.frequency.setValueAtTime(150, t);
              osc.frequency.linearRampToValueAtTime(80, t + 0.12);
              gain.gain.setValueAtTime(0.15, t);
              gain.gain.linearRampToValueAtTime(0, t + 0.15);
              osc.start(t);
              osc.stop(t + 0.15);
              break;
            case "death": {
              gain.gain.setValueAtTime(0, t);
              osc.start(t);
              osc.stop(t + 0.01);
              const freqs = [440, 330, 220, 110];
              freqs.forEach((freq, i) => {
                const o = ac.createOscillator();
                const g = ac.createGain();
                o.connect(g);
                g.connect(ac.destination);
                o.type = "sawtooth";
                o.frequency.setValueAtTime(freq, t + i * 0.15);
                o.frequency.linearRampToValueAtTime(freq * 0.7, t + i * 0.15 + 0.15);
                g.gain.setValueAtTime(0.12, t + i * 0.15);
                g.gain.linearRampToValueAtTime(0, t + i * 0.15 + 0.18);
                o.start(t + i * 0.15);
                o.stop(t + i * 0.15 + 0.18);
              });
              break;
            }
            case "spit":
              osc.type = "square";
              osc.frequency.setValueAtTime(600, t);
              osc.frequency.linearRampToValueAtTime(200, t + 0.07);
              gain.gain.setValueAtTime(0.05, t);
              gain.gain.linearRampToValueAtTime(0, t + 0.07);
              osc.start(t);
              osc.stop(t + 0.07);
              break;
            case "chain":
              osc.type = "sawtooth";
              osc.frequency.setValueAtTime(1200, t);
              osc.frequency.linearRampToValueAtTime(300, t + 0.05);
              osc.frequency.linearRampToValueAtTime(900, t + 0.08);
              osc.frequency.linearRampToValueAtTime(200, t + 0.12);
              gain.gain.setValueAtTime(0.1, t);
              gain.gain.linearRampToValueAtTime(0, t + 0.12);
              osc.start(t);
              osc.stop(t + 0.12);
              break;
            case "meteor":
              osc.type = "sine";
              osc.frequency.setValueAtTime(60, t);
              osc.frequency.linearRampToValueAtTime(40, t + 0.2);
              gain.gain.setValueAtTime(0.18, t);
              gain.gain.linearRampToValueAtTime(0, t + 0.25);
              osc.start(t);
              osc.stop(t + 0.25);
              break;
            case "dragonstorm": {
              osc.type = "sawtooth";
              osc.frequency.setValueAtTime(100, t);
              osc.frequency.linearRampToValueAtTime(200, t + 0.1);
              gain.gain.setValueAtTime(0.1, t);
              gain.gain.linearRampToValueAtTime(0, t + 0.15);
              osc.start(t);
              osc.stop(t + 0.15);
              const o2 = ac.createOscillator();
              const g2 = ac.createGain();
              o2.connect(g2);
              g2.connect(ac.destination);
              o2.type = "square";
              o2.frequency.setValueAtTime(800, t + 0.03);
              o2.frequency.linearRampToValueAtTime(400, t + 0.1);
              g2.gain.setValueAtTime(0.06, t + 0.03);
              g2.gain.linearRampToValueAtTime(0, t + 0.12);
              o2.start(t + 0.03);
              o2.stop(t + 0.12);
              break;
            }
            case "charge": {
              osc.type = "sawtooth";
              osc.frequency.setValueAtTime(150, t);
              osc.frequency.linearRampToValueAtTime(300, t + 0.08);
              osc.frequency.linearRampToValueAtTime(80, t + 0.15);
              gain.gain.setValueAtTime(0.15, t);
              gain.gain.linearRampToValueAtTime(0.08, t + 0.08);
              gain.gain.linearRampToValueAtTime(0, t + 0.2);
              osc.start(t);
              osc.stop(t + 0.2);
              break;
            }
            case "hive_burst": {
              osc.type = "sine";
              osc.frequency.setValueAtTime(180, t);
              osc.frequency.linearRampToValueAtTime(90, t + 0.08);
              osc.frequency.linearRampToValueAtTime(200, t + 0.12);
              osc.frequency.linearRampToValueAtTime(60, t + 0.2);
              gain.gain.setValueAtTime(0.12, t);
              gain.gain.linearRampToValueAtTime(0.08, t + 0.08);
              gain.gain.linearRampToValueAtTime(0, t + 0.2);
              osc.start(t);
              osc.stop(t + 0.2);
              const hb2 = ac.createOscillator();
              const hg2 = ac.createGain();
              hb2.connect(hg2);
              hg2.connect(ac.destination);
              hb2.type = "square";
              hb2.frequency.setValueAtTime(500, t + 0.02);
              hb2.frequency.linearRampToValueAtTime(250, t + 0.1);
              hb2.frequency.linearRampToValueAtTime(600, t + 0.15);
              hg2.gain.setValueAtTime(0.04, t + 0.02);
              hg2.gain.linearRampToValueAtTime(0, t + 0.18);
              hb2.start(t + 0.02);
              hb2.stop(t + 0.18);
              break;
            }
            case "boss_telegraph": {
              osc.type = "sawtooth";
              osc.frequency.setValueAtTime(60, t);
              osc.frequency.linearRampToValueAtTime(180, t + 0.25);
              gain.gain.setValueAtTime(0.05, t);
              gain.gain.linearRampToValueAtTime(0.18, t + 0.2);
              gain.gain.linearRampToValueAtTime(0, t + 0.3);
              osc.start(t);
              osc.stop(t + 0.3);
              const bt2 = ac.createOscillator();
              const bg2 = ac.createGain();
              bt2.connect(bg2);
              bg2.connect(ac.destination);
              bt2.type = "square";
              bt2.frequency.setValueAtTime(300, t + 0.1);
              bt2.frequency.linearRampToValueAtTime(600, t + 0.25);
              bg2.gain.setValueAtTime(0.03, t + 0.1);
              bg2.gain.linearRampToValueAtTime(0.08, t + 0.22);
              bg2.gain.linearRampToValueAtTime(0, t + 0.3);
              bt2.start(t + 0.1);
              bt2.stop(t + 0.3);
              break;
            }
            case "boss_step": {
              osc.type = "sine";
              osc.frequency.setValueAtTime(50, t);
              osc.frequency.linearRampToValueAtTime(30, t + 0.1);
              gain.gain.setValueAtTime(0.1, t);
              gain.gain.linearRampToValueAtTime(0, t + 0.12);
              osc.start(t);
              osc.stop(t + 0.12);
              break;
            }
            case "shield_hum": {
              osc.type = "triangle";
              osc.frequency.setValueAtTime(220, t);
              osc.frequency.linearRampToValueAtTime(260, t + 0.06);
              osc.frequency.linearRampToValueAtTime(220, t + 0.12);
              gain.gain.setValueAtTime(0.05, t);
              gain.gain.linearRampToValueAtTime(0.08, t + 0.04);
              gain.gain.linearRampToValueAtTime(0, t + 0.12);
              osc.start(t);
              osc.stop(t + 0.12);
              break;
            }
            case "zap": {
              osc.type = "sawtooth";
              osc.frequency.setValueAtTime(2e3, t);
              osc.frequency.linearRampToValueAtTime(600, t + 0.03);
              osc.frequency.linearRampToValueAtTime(1800, t + 0.05);
              osc.frequency.linearRampToValueAtTime(400, t + 0.08);
              gain.gain.setValueAtTime(0.07, t);
              gain.gain.linearRampToValueAtTime(0.04, t + 0.03);
              gain.gain.linearRampToValueAtTime(0.06, t + 0.05);
              gain.gain.linearRampToValueAtTime(0, t + 0.08);
              osc.start(t);
              osc.stop(t + 0.08);
              break;
            }
            default:
              gain.gain.setValueAtTime(0, t);
              osc.start(t);
              osc.stop(t + 0.01);
          }
        } catch (e) {
        }
      }
      var ANALYTICS_URL = "https://survivors-analytics.sammcgrail.workers.dev";
      var sessionStart = Date.now();
      var track = (event) => fetch(`${ANALYTICS_URL}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event)
      }).catch(() => {
      });
      track({ type: "page_load" });
      window.addEventListener("beforeunload", () => {
        track({ type: "session_end", duration_ms: Date.now() - sessionStart });
      });
      var bgMusic = null;
      var bgMusicGain = null;
      var musicFading = false;
      function startMusic() {
        try {
          const ac = getAudio();
          if (ac.state === "suspended") ac.resume();
          if (!bgMusic) {
            bgMusic = new Audio();
            bgMusic.loop = true;
            bgMusic.volume = 1;
            if (bgMusic.canPlayType("audio/ogg; codecs=vorbis")) {
              bgMusic.src = "survivors_battle.ogg";
            } else {
              bgMusic.src = "survivors_battle.mp3";
            }
            const src = ac.createMediaElementSource(bgMusic);
            bgMusicGain = ac.createGain();
            bgMusicGain.gain.value = 0;
            src.connect(bgMusicGain);
            bgMusicGain.connect(ac.destination);
          }
          bgMusic.currentTime = 0;
          bgMusic.play().catch(() => {
          });
          bgMusicGain.gain.cancelScheduledValues(ac.currentTime);
          bgMusicGain.gain.setValueAtTime(0, ac.currentTime);
          bgMusicGain.gain.linearRampToValueAtTime(0.35, ac.currentTime + 2);
          musicFading = false;
        } catch (e) {
        }
      }
      function fadeOutMusic() {
        if (!bgMusic || !bgMusicGain || musicFading) return;
        musicFading = true;
        try {
          const ac = getAudio();
          bgMusicGain.gain.cancelScheduledValues(ac.currentTime);
          bgMusicGain.gain.setValueAtTime(bgMusicGain.gain.value, ac.currentTime);
          bgMusicGain.gain.linearRampToValueAtTime(0, ac.currentTime + 1.5);
          setTimeout(() => {
            bgMusic.pause();
            musicFading = false;
          }, 1600);
        } catch (e) {
        }
      }
      function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
      window.addEventListener("resize", resize);
      resize();
      var game = null;
      var keys = { up: false, down: false, left: false, right: false };
      var analogMove = { x: 0, y: 0 };
      var paused = false;
      var selectedWeapon = "spit";
      function selectWeapon(type) {
        selectedWeapon = type;
        document.querySelectorAll(".weapon-card").forEach((c) => {
          c.classList.toggle("selected", c.dataset.weapon === type);
        });
      }
      var gameStarted = false;
      var POWERUPS = [
        { id: "speed", name: "Swift Feet", desc: "Move 15% faster", icon: "\u26A1", stack: 0, max: 5, apply(g) {
          g.player.speed *= 1.15;
        } },
        { id: "damage", name: "Raw Power", desc: "+25% damage to all weapons", icon: "\u{1F4A5}", stack: 0, max: 5, apply(g) {
          g.player.damageMulti *= 1.25;
        } },
        { id: "hp_regen", name: "Regeneration", desc: "Heal 2 HP/sec", icon: "\u{1F49A}", stack: 0, max: 3, apply(g) {
          g.player.hpRegen += 2;
        } },
        { id: "attack_speed", name: "Haste", desc: "+20% attack speed", icon: "\u{1F525}", stack: 0, max: 5, apply(g) {
          g.player.attackSpeedMulti *= 1.2;
        } },
        { id: "magnet", name: "Magnet", desc: "+50% XP pickup range", icon: "\u{1F9F2}", stack: 0, max: 3, apply(g) {
          g.player.magnetRange *= 1.5;
        } },
        { id: "max_hp", name: "Vitality", desc: "+25 max HP, heal to full", icon: "\u2764\uFE0F", stack: 0, max: 3, apply(g) {
          g.player.maxHp += 25;
          g.player.hp = g.player.maxHp;
        } },
        { id: "weapon_spit", name: "Magic Spit", desc: "Projectile weapon \u2014 fires at nearest enemy", icon: "\u{1F52E}", stack: 0, max: 1, apply(g) {
          g.player.weapons.push(createWeapon("spit"));
        } },
        { id: "weapon_breath", name: "Dragon Breath", desc: "Aura weapon \u2014 damages nearby enemies", icon: "\u{1F300}", stack: 0, max: 1, apply(g) {
          g.player.weapons.push(createWeapon("breath"));
        } },
        { id: "weapon_charge", name: "Bull Rush", desc: "Sweep weapon \u2014 charges in move direction", icon: "\u{1F402}", stack: 0, max: 1, apply(g) {
          g.player.weapons.push(createWeapon("charge"));
        } },
        { id: "weapon_orbit", name: "Blade Orbit", desc: "Orbiting blades damage enemies on contact", icon: "\u{1F5E1}\uFE0F", stack: 0, max: 1, apply(g) {
          g.player.weapons.push(createWeapon("orbit"));
        } },
        { id: "weapon_chain", name: "Chain Lightning", desc: "Zaps nearest enemy, chains to 2 more", icon: "\u26A1", stack: 0, max: 1, apply(g) {
          g.player.weapons.push(createWeapon("chain"));
        } },
        { id: "weapon_meteor", name: "Meteor", desc: "Drops AoE on enemy clusters", icon: "\u2604\uFE0F", stack: 0, max: 1, apply(g) {
          g.player.weapons.push(createWeapon("meteor"));
        } },
        { id: "weapon_shield", name: "Barrier", desc: "Knockback shield \u2014 pushes and damages nearby enemies", icon: "\u{1F6E1}\uFE0F", stack: 0, max: 1, apply(g) {
          g.player.weapons.push(createWeapon("shield"));
        } },
        { id: "weapon_lightning_field", name: "Lightning Field", desc: "Passive zaps random nearby enemies", icon: "\u26A1", stack: 0, max: 1, apply(g) {
          g.player.weapons.push(createWeapon("lightning_field"));
        } },
        { id: "spit_up", name: "Spit+", desc: "Extra projectile + pierce", icon: "\u{1F52E}+", stack: 0, max: 3, requires: "weapon_spit", apply(g) {
          let w = g.player.weapons.find((w2) => w2.type === "spit");
          if (w) {
            w.count++;
            w.pierce++;
          }
        } },
        { id: "breath_up", name: "Breath+", desc: "+30% aura radius", icon: "\u{1F300}+", stack: 0, max: 3, requires: "weapon_breath", apply(g) {
          let w = g.player.weapons.find((w2) => w2.type === "breath");
          if (w) w.radius *= 1.3;
        } },
        { id: "charge_up", name: "Rush+", desc: "+40% charge damage & width", icon: "\u{1F402}+", stack: 0, max: 3, requires: "weapon_charge", apply(g) {
          let w = g.player.weapons.find((w2) => w2.type === "charge");
          if (w) {
            w.damage *= 1.4;
            w.width *= 1.4;
          }
        } },
        { id: "orbit_up", name: "Orbit+", desc: "+1 orbiting blade", icon: "\u{1F5E1}\uFE0F+", stack: 0, max: 3, requires: "weapon_orbit", apply(g) {
          let w = g.player.weapons.find((w2) => w2.type === "orbit");
          if (w) w.bladeCount++;
        } },
        { id: "chain_up", name: "Chain+", desc: "+1 chain target", icon: "\u26A1+", stack: 0, max: 3, requires: "weapon_chain", apply(g) {
          let w = g.player.weapons.find((w2) => w2.type === "chain");
          if (w) w.chains++;
        } },
        { id: "meteor_up", name: "Meteor+", desc: "+40% blast radius & damage", icon: "\u2604\uFE0F+", stack: 0, max: 3, requires: "weapon_meteor", apply(g) {
          let w = g.player.weapons.find((w2) => w2.type === "meteor");
          if (w) {
            w.blastRadius *= 1.4;
            w.damage *= 1.4;
          }
        } },
        { id: "shield_up", name: "Barrier+", desc: "+25% radius & knockback", icon: "\u{1F6E1}\uFE0F+", stack: 0, max: 3, requires: "weapon_shield", apply(g) {
          let w = g.player.weapons.find((w2) => w2.type === "shield");
          if (w) {
            w.radius *= 1.25;
            w.knockback *= 1.25;
          }
        } },
        { id: "lightning_field_up", name: "Field+", desc: "+1 zap target & +20% radius", icon: "\u26A1+", stack: 0, max: 3, requires: "weapon_lightning_field", apply(g) {
          let w = g.player.weapons.find((w2) => w2.type === "lightning_field");
          if (w) {
            w.zapCount++;
            w.radius *= 1.2;
          }
        } },
        // EVOLUTION: max spit (4 stacks) + max breath (4 stacks) = Dragon Storm
        {
          id: "evo_dragon_storm",
          name: "DRAGON STORM",
          desc: "Spit + Breath fuse into homing fireballs + damage aura",
          icon: "\u{1F409}",
          stack: 0,
          max: 1,
          get hidden() {
            const spit = POWERUPS.find((p) => p.id === "spit_up");
            const breath = POWERUPS.find((p) => p.id === "breath_up");
            return !(spit && spit.stack >= 3 && breath && breath.stack >= 3);
          },
          apply(g) {
            g.player.weapons = g.player.weapons.filter((w) => w.type !== "spit" && w.type !== "breath");
            g.player.weapons.push(createWeapon("dragon_storm"));
            g.screenShake = 0.5;
            spawnParticles(g.player.x, g.player.y, "#f39c12", 20);
          }
        }
      ];
      function initGame() {
        POWERUPS.forEach((p2) => p2.stack = 0);
        const p = {
          x: WORLD_W / 2,
          y: WORLD_H / 2,
          vx: 0,
          vy: 0,
          hp: PLAYER_MAX_HP,
          maxHp: PLAYER_MAX_HP,
          radius: PLAYER_RADIUS,
          speed: PLAYER_SPEED,
          damageMulti: 1,
          attackSpeedMulti: 1,
          hpRegen: 0,
          magnetRange: XP_MAGNET_RANGE,
          xp: 0,
          xpToLevel: 45,
          level: 1,
          weapons: [createWeapon(selectedWeapon)],
          // start with chosen weapon
          alive: true,
          iframes: 0,
          // invincibility frames after hit
          facing: { x: 1, y: 0 }
        };
        POWERUPS.find((p2) => p2.id === "weapon_" + selectedWeapon).stack = 1;
        return {
          player: p,
          enemies: [],
          projectiles: [],
          gems: [],
          particles: [],
          floatingTexts: [],
          time: 0,
          wave: 1,
          waveTimer: 0,
          waveDuration: 20,
          // seconds per wave (longer waves = more time to feel the pressure)
          spawnTimer: 0,
          spawnRate: 2,
          // seconds between spawn bursts (decreases per wave)
          specialWaveMsg: null,
          specialWaveMsgTimer: 0,
          waveMsg: "",
          waveMsgTimer: 0,
          kills: 0,
          playerName: "you",
          deathFeed: [],
          // { text, time } — fading event log
          camera: { x: p.x, y: p.y },
          screenShake: 0
        };
      }
      function spawnEnemy(g) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 500 + Math.random() * 200;
        const ex = g.player.x + Math.cos(angle) * dist;
        const ey = g.player.y + Math.sin(angle) * dist;
        const e = enemyType(g.wave);
        e.x = Math.max(e.radius, Math.min(WORLD_W - e.radius, ex));
        e.y = Math.max(e.radius, Math.min(WORLD_H - e.radius, ey));
        e.hitFlash = 0;
        g.enemies.push(e);
      }
      function spawnGem(x, y, xp) {
        game.gems.push({ x, y, xp, radius: XP_RADIUS, alpha: 1 });
      }
      function spawnParticles(x, y, color, count) {
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 50 + Math.random() * 150;
          game.particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.3 + Math.random() * 0.4,
            maxLife: 0.3 + Math.random() * 0.4,
            color,
            radius: 2 + Math.random() * 3
          });
        }
      }
      function update(dt) {
        if (!game || !game.player.alive || paused) return;
        const g = game;
        const p = g.player;
        g.time += dt;
        g.waveTimer += dt;
        if (g.waveTimer >= g.waveDuration) {
          g.wave++;
          g.waveTimer = 0;
          g.deathFeed.push({ text: `${g.playerName} survived wave ${g.wave - 1}`, time: g.time });
          g.spawnRate = Math.max(0.25, 2 * Math.pow(0.88, g.wave - 1));
          g.waveMsg = `WAVE ${g.wave}`;
          g.waveMsgTimer = 2;
          const special = SPECIAL_WAVES[g.wave];
          if (special) {
            g.specialWaveMsg = special.name;
            g.specialWaveMsgTimer = 2.5;
          }
        }
        if (g.waveMsgTimer > 0) g.waveMsgTimer -= dt;
        if (g.specialWaveMsgTimer > 0) g.specialWaveMsgTimer -= dt;
        g.spawnTimer -= dt;
        if (g.spawnTimer <= 0) {
          const special = SPECIAL_WAVES[g.wave];
          let baseCount = 1 + Math.floor(g.wave / 2);
          if (special) baseCount = Math.ceil(baseCount * special.countMulti);
          const count = Math.min(baseCount, 12);
          const maxEnemies = 80 + g.wave * 10;
          const toSpawn = Math.min(count, maxEnemies - g.enemies.length);
          for (let i = 0; i < toSpawn; i++) spawnEnemy(g);
          g.spawnTimer = g.spawnRate;
        }
        let dx, dy;
        if (analogMove.x !== 0 || analogMove.y !== 0) {
          dx = analogMove.x;
          dy = analogMove.y;
        } else {
          dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
          dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
          if (dx && dy) {
            dx *= 0.7071;
            dy *= 0.7071;
          }
        }
        if (dx || dy) p.facing = { x: dx, y: dy };
        p.x += dx * p.speed * dt;
        p.y += dy * p.speed * dt;
        p.x = Math.max(p.radius, Math.min(WORLD_W - p.radius, p.x));
        p.y = Math.max(p.radius, Math.min(WORLD_H - p.radius, p.y));
        if (p.hpRegen > 0) {
          p.hp = Math.min(p.maxHp, p.hp + p.hpRegen * dt);
        }
        if (p.iframes > 0) p.iframes -= dt;
        for (const w of p.weapons) {
          w.timer -= dt * p.attackSpeedMulti;
          if (w.timer <= 0) {
            w.timer = w.cooldown;
            fireWeapon(g, w);
          }
          if (w.type === "breath") w.pulsePhase = (w.pulsePhase || 0) + dt * 3;
          if (w.type === "dragon_storm") w.pulsePhase = (w.pulsePhase || 0) + dt * 4;
          if (w.type === "charge" && w.active) {
            w.chargeTimer -= dt;
            if (w.chargeTimer <= 0) {
              w.active = false;
            }
          }
          if (w.type === "orbit") {
            w.phase = (w.phase || 0) + w.rotSpeed * dt;
            for (let b = 0; b < w.bladeCount; b++) {
              const angle = w.phase + b * Math.PI * 2 / w.bladeCount;
              const bx = p.x + Math.cos(angle) * w.radius;
              const by = p.y + Math.sin(angle) * w.radius;
              for (let j = g.enemies.length - 1; j >= 0; j--) {
                const e = g.enemies[j];
                const dx2 = bx - e.x;
                const dy2 = by - e.y;
                if (dx2 * dx2 + dy2 * dy2 < (10 + e.radius) ** 2) {
                  damageEnemy(g, e, j, w.damage * p.damageMulti * dt * 8);
                }
              }
            }
          }
          if (w.type === "shield") {
            w.phase = (w.phase || 0) + dt * 4;
            let shieldHit = false;
            for (let j = g.enemies.length - 1; j >= 0; j--) {
              const e = g.enemies[j];
              const edx = e.x - p.x;
              const edy = e.y - p.y;
              const dist = Math.sqrt(edx * edx + edy * edy);
              if (dist < w.radius + e.radius && dist > 1) {
                shieldHit = true;
                const nx = edx / dist;
                const ny = edy / dist;
                e.x += nx * w.knockback * dt;
                e.y += ny * w.knockback * dt;
                damageEnemy(g, e, j, w.damage * p.damageMulti * dt * 2);
              }
            }
            if (shieldHit) {
              w._humTimer = (w._humTimer || 0) - dt;
              if (w._humTimer <= 0) {
                sfx("shield_hum");
                w._humTimer = 0.4;
              }
            }
          }
          if (w.type === "lightning_field" && w.timer >= w.cooldown - 0.01) {
            const inRange = [];
            for (const e of g.enemies) {
              const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
              if (d2 < w.radius * w.radius) inRange.push(e);
            }
            for (let z = inRange.length - 1; z > 0; z--) {
              const r = Math.floor(Math.random() * (z + 1));
              [inRange[z], inRange[r]] = [inRange[r], inRange[z]];
            }
            const targets = inRange.slice(0, w.zapCount);
            g.chainEffects = g.chainEffects || [];
            for (const t of targets) {
              for (let j = g.enemies.length - 1; j >= 0; j--) {
                if (g.enemies[j] === t) {
                  damageEnemy(g, g.enemies[j], j, w.damage * p.damageMulti);
                  break;
                }
              }
              g.chainEffects.push({ points: [{ x: p.x, y: p.y }, { x: t.x, y: t.y }], life: 0.15, color: w.color });
            }
            if (targets.length > 0) sfx("zap");
          }
        }
        for (let i = g.projectiles.length - 1; i >= 0; i--) {
          const proj = g.projectiles[i];
          proj.x += proj.vx * dt;
          proj.y += proj.vy * dt;
          proj.dist += proj.speed * dt;
          if (proj.dist > proj.range) {
            g.projectiles.splice(i, 1);
            continue;
          }
          for (let j = g.enemies.length - 1; j >= 0; j--) {
            const e = g.enemies[j];
            const edx = proj.x - e.x;
            const edy = proj.y - e.y;
            if (edx * edx + edy * edy < (proj.radius + e.radius) ** 2) {
              damageEnemy(g, e, j, proj.damage * p.damageMulti);
              proj.pierce--;
              if (proj.pierce <= 0) {
                g.projectiles.splice(i, 1);
                break;
              }
            }
          }
        }
        for (const w of p.weapons) {
          if (w.type === "breath") {
            for (let j = g.enemies.length - 1; j >= 0; j--) {
              const e = g.enemies[j];
              const edx = p.x - e.x;
              const edy = p.y - e.y;
              const dist = Math.sqrt(edx * edx + edy * edy);
              if (dist < w.radius + e.radius) {
                damageEnemy(g, e, j, w.damage * p.damageMulti * dt);
              }
            }
          }
        }
        for (const w of p.weapons) {
          if (w.type === "charge" && w.active) {
            const cdx = w.chargeDx;
            const cdy = w.chargeDy;
            for (let j = g.enemies.length - 1; j >= 0; j--) {
              const e = g.enemies[j];
              const ex = e.x - p.x;
              const ey = e.y - p.y;
              const forward = ex * cdx + ey * cdy;
              const lateral = Math.abs(ex * -cdy + ey * cdx);
              if (forward > -w.width && forward < w.speed * w.duration && lateral < w.width + e.radius) {
                damageEnemy(g, e, j, w.damage * p.damageMulti * dt * 3);
              }
            }
          }
        }
        const HASH_CELL = 50;
        for (let i = g.enemies.length - 1; i >= 0; i--) {
          const e = g.enemies[i];
          if (e.dying !== void 0) {
            e.dying -= dt;
            if (e.dying <= 0) {
              g.enemies.splice(i, 1);
            }
            continue;
          }
          const edx = p.x - e.x;
          const edy = p.y - e.y;
          const dist = Math.sqrt(edx * edx + edy * edy);
          if (dist > 1) {
            if (e.name === "ghost") {
              const nx = edx / dist;
              const ny = edy / dist;
              const sign = e.orbitSign || 1;
              const perpX = -ny * sign;
              const perpY = nx * sign;
              const inward = dist > 100 ? 0.8 : dist > 30 ? 1 : 1;
              const orbit = dist > 100 ? 0.6 : dist > 30 ? 0.3 : 0.1;
              e.x += (nx * inward + perpX * orbit) * e.speed * dt;
              e.y += (ny * inward + perpY * orbit) * e.speed * dt;
            } else if (e.name === "boss") {
              if (e.chargeTimer === void 0) e.chargeTimer = 3 + Math.random() * 2;
              if (e.charging === void 0) e.charging = 0;
              if (e.charging > 0) {
                e.x += e.chargeDx * e.speed * 3 * dt;
                e.y += e.chargeDy * e.speed * 3 * dt;
                e.charging -= dt;
              } else {
                e.x += edx / dist * e.speed * 0.5 * dt;
                e.y += edy / dist * e.speed * 0.5 * dt;
                e.chargeTimer -= dt;
                if (e.stepTimer === void 0) e.stepTimer = 0.8;
                e.stepTimer -= dt;
                if (e.stepTimer <= 0 && dist < 500) {
                  sfx("boss_step");
                  e.stepTimer = 0.7 + Math.random() * 0.3;
                }
                if (e.chargeTimer <= 0 && dist < 400) {
                  e.chargeDx = edx / dist;
                  e.chargeDy = edy / dist;
                  e.charging = 0.8;
                  e.chargeTimer = 4 + Math.random() * 3;
                  spawnParticles(e.x, e.y, "#d63031", 12);
                  sfx("boss_telegraph");
                }
              }
            } else {
              e.x += edx / dist * e.speed * dt;
              e.y += edy / dist * e.speed * dt;
            }
          }
          if (e.name === "spawner" && e.spawnTimer !== void 0) {
            e.spawnTimer -= dt;
            if (e.spawnTimer <= 0) {
              e.spawnTimer = 3 + Math.random() * 2;
              const count = 3 + Math.floor(Math.random() * 3);
              for (let s = 0; s < count; s++) {
                const sa = Math.random() * Math.PI * 2;
                const sr = 20 + Math.random() * 20;
                const base = ENEMY_TYPES.find((t) => t.name === "swarm");
                const minion = scaleEnemy(base, g.wave);
                minion.x = e.x + Math.cos(sa) * sr;
                minion.y = e.y + Math.sin(sa) * sr;
                minion.hitFlash = 0;
                g.enemies.push(minion);
              }
              spawnParticles(e.x, e.y, "#fdcb6e", 8);
              sfx("hive_burst");
            }
          }
          if (e.hitFlash > 0) e.hitFlash -= dt * 5;
          if (dist < p.radius + e.radius && p.iframes <= 0) {
            p.hp -= e.damage;
            p.iframes = 0.5;
            g.screenShake = 0.15;
            spawnParticles(p.x, p.y, "#e74c3c", 5);
            sfx("playerhit");
            if (p.hp <= 0) {
              p.hp = 0;
              p.alive = false;
              sfx("death");
              g.deathFeed.push({ text: `${g.playerName} killed by ${e.name}`, time: g.time });
              showDeathScreen(g);
            }
          }
        }
        const cells = /* @__PURE__ */ new Map();
        for (let i = 0; i < g.enemies.length; i++) {
          const e = g.enemies[i];
          const cx = Math.floor(e.x / HASH_CELL);
          const cy = Math.floor(e.y / HASH_CELL);
          const k = cx * 1e5 + cy;
          let bucket = cells.get(k);
          if (!bucket) {
            bucket = [];
            cells.set(k, bucket);
          }
          bucket.push(i);
        }
        for (let i = 0; i < g.enemies.length; i++) {
          const e = g.enemies[i];
          const cx = Math.floor(e.x / HASH_CELL);
          const cy = Math.floor(e.y / HASH_CELL);
          for (let dx2 = -1; dx2 <= 1; dx2++) {
            for (let dy2 = -1; dy2 <= 1; dy2++) {
              const bucket = cells.get((cx + dx2) * 1e5 + (cy + dy2));
              if (!bucket) continue;
              for (let bi = 0; bi < bucket.length; bi++) {
                const j = bucket[bi];
                if (j <= i) continue;
                const e2 = g.enemies[j];
                const rx = e.x - e2.x;
                const ry = e.y - e2.y;
                const rd = Math.sqrt(rx * rx + ry * ry);
                const minD = e.radius + e2.radius;
                if (rd < minD && rd > 0.1) {
                  const push = (minD - rd) * 0.5;
                  const nx = rx / rd;
                  const ny = ry / rd;
                  e.x += nx * push;
                  e.y += ny * push;
                  e2.x -= nx * push;
                  e2.y -= ny * push;
                }
              }
            }
          }
        }
        for (let i = g.gems.length - 1; i >= 0; i--) {
          const gem = g.gems[i];
          const gdx = p.x - gem.x;
          const gdy = p.y - gem.y;
          const dist = Math.sqrt(gdx * gdx + gdy * gdy);
          if (dist < p.magnetRange) {
            const pull = XP_MAGNET_SPEED * dt;
            gem.x += gdx / dist * Math.min(pull, dist);
            gem.y += gdy / dist * Math.min(pull, dist);
          }
          if (dist < p.radius + gem.radius) {
            p.xp += gem.xp;
            sfx("xp");
            g.floatingTexts.push({
              x: gem.x,
              y: gem.y,
              text: "+" + gem.xp,
              color: "#3498db",
              life: 0.8,
              maxLife: 0.8,
              vy: -60
            });
            spawnParticles(gem.x, gem.y, "#3498db", 3);
            g.gems.splice(i, 1);
            while (p.xp >= p.xpToLevel) {
              p.xp -= p.xpToLevel;
              p.level++;
              p.xpToLevel = Math.floor(p.xpToLevel * 1.45);
              g.levelFlash = 0.15;
              showLevelUp(g);
            }
          }
        }
        for (let i = g.particles.length - 1; i >= 0; i--) {
          const pt = g.particles[i];
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          pt.life -= dt;
          if (pt.life <= 0) g.particles.splice(i, 1);
        }
        for (let i = g.floatingTexts.length - 1; i >= 0; i--) {
          const ft = g.floatingTexts[i];
          ft.y += ft.vy * dt;
          ft.life -= dt;
          if (ft.life <= 0) g.floatingTexts.splice(i, 1);
        }
        g.chainEffects = g.chainEffects || [];
        for (let i = g.chainEffects.length - 1; i >= 0; i--) {
          g.chainEffects[i].life -= dt;
          if (g.chainEffects[i].life <= 0) g.chainEffects.splice(i, 1);
        }
        g.meteorEffects = g.meteorEffects || [];
        for (let i = g.meteorEffects.length - 1; i >= 0; i--) {
          const m = g.meteorEffects[i];
          m.life -= dt;
          if (m.phase === "warn" && m.life <= 0) {
            m.phase = "explode";
            m.life = 0.3;
            g.screenShake = 0.1;
            sfx("meteor");
            for (let j = g.enemies.length - 1; j >= 0; j--) {
              const e = g.enemies[j];
              const dx2 = m.x - e.x;
              const dy2 = m.y - e.y;
              if (dx2 * dx2 + dy2 * dy2 < (m.radius + e.radius) ** 2) {
                damageEnemy(g, g.enemies[j], j, m.damage);
              }
            }
            spawnParticles(m.x, m.y, m.color, 12);
          } else if (m.phase === "explode" && m.life <= 0) {
            g.meteorEffects.splice(i, 1);
          }
        }
        for (const w of p.weapons) {
          if (w.type === "dragon_storm") {
            for (let j = g.enemies.length - 1; j >= 0; j--) {
              const e = g.enemies[j];
              const dx2 = p.x - e.x;
              const dy2 = p.y - e.y;
              if (dx2 * dx2 + dy2 * dy2 < (w.auraRadius + e.radius) ** 2) {
                damageEnemy(g, e, j, w.auraDamage * p.damageMulti * dt);
              }
            }
          }
        }
        const camLerp = 1 - Math.exp(-12 * dt);
        g.camera.x += (p.x - g.camera.x) * camLerp;
        g.camera.y += (p.y - g.camera.y) * camLerp;
        if (g.screenShake > 0) g.screenShake -= dt;
        if (g.levelFlash > 0) g.levelFlash -= dt;
        const xpPct = Math.round(p.xp / p.xpToLevel * 1e3);
        if (xpPct !== hudCache.xpPct) {
          hudEl.xpFill.style.width = xpPct / 10 + "%";
          hudCache.xpPct = xpPct;
        }
      }
      function fireWeapon(g, w) {
        const p = g.player;
        if (w.type === "spit") {
          let nearest = null;
          let nearestDist = w.range;
          for (const e of g.enemies) {
            const dx2 = e.x - p.x;
            const dy2 = e.y - p.y;
            const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
            if (d2 < nearestDist) {
              nearest = e;
              nearestDist = d2;
            }
          }
          if (!nearest) return;
          sfx("spit");
          const dx = nearest.x - p.x;
          const dy = nearest.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const nx = dx / d;
          const ny = dy / d;
          for (let i = 0; i < w.count; i++) {
            const spread = w.count > 1 ? (i - (w.count - 1) / 2) * 0.15 : 0;
            const cos = Math.cos(spread);
            const sin = Math.sin(spread);
            const fx = nx * cos - ny * sin;
            const fy = nx * sin + ny * cos;
            g.projectiles.push({
              x: p.x + fx * 20,
              y: p.y + fy * 20,
              vx: fx * w.speed,
              vy: fy * w.speed,
              speed: w.speed,
              damage: w.damage,
              range: w.range,
              dist: 0,
              pierce: w.pierce,
              radius: 5,
              color: w.color
            });
          }
        } else if (w.type === "charge") {
          const f = p.facing;
          const d = Math.sqrt(f.x * f.x + f.y * f.y);
          if (d > 0.01) {
            w.active = true;
            w.chargeTimer = w.duration;
            w.chargeDx = f.x / d;
            w.chargeDy = f.y / d;
            p.x += w.chargeDx * w.speed * w.duration;
            p.y += w.chargeDy * w.speed * w.duration;
            p.x = Math.max(p.radius, Math.min(WORLD_W - p.radius, p.x));
            p.y = Math.max(p.radius, Math.min(WORLD_H - p.radius, p.y));
            g.screenShake = 0.1;
            sfx("charge");
            spawnParticles(p.x, p.y, w.color, 8);
          }
        } else if (w.type === "chain") {
          if (g.enemies.length === 0) return;
          sfx("chain");
          let sorted = g.enemies.slice().sort((a, b) => {
            const da = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
            const db = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
            return da - db;
          });
          const inRange = sorted.filter((e) => {
            const d = Math.sqrt((e.x - p.x) ** 2 + (e.y - p.y) ** 2);
            return d < w.range;
          });
          if (inRange.length === 0) return;
          const targets = [inRange[0]];
          const hit = /* @__PURE__ */ new Set([inRange[0]]);
          for (let c = 0; c < w.chains && targets.length > 0; c++) {
            const last = targets[targets.length - 1];
            let best = null, bestDist = w.chainRange;
            for (const e of g.enemies) {
              if (hit.has(e)) continue;
              const d = Math.sqrt((e.x - last.x) ** 2 + (e.y - last.y) ** 2);
              if (d < bestDist) {
                best = e;
                bestDist = d;
              }
            }
            if (best) {
              targets.push(best);
              hit.add(best);
            }
          }
          g.chainEffects = g.chainEffects || [];
          const chainPoints = [{ x: p.x, y: p.y }];
          for (const t of targets) {
            chainPoints.push({ x: t.x, y: t.y });
            for (let j = g.enemies.length - 1; j >= 0; j--) {
              if (g.enemies[j] === t) {
                damageEnemy(g, g.enemies[j], j, w.damage * p.damageMulti);
                break;
              }
            }
          }
          g.chainEffects.push({ points: chainPoints, life: 0.2, color: w.color });
        } else if (w.type === "meteor") {
          if (g.enemies.length === 0) return;
          const target = g.enemies[Math.floor(Math.random() * g.enemies.length)];
          g.meteorEffects = g.meteorEffects || [];
          g.meteorEffects.push({
            x: target.x,
            y: target.y,
            radius: w.blastRadius,
            damage: w.damage * p.damageMulti,
            life: 0.5,
            // warning phase
            phase: "warn",
            color: w.color
          });
        } else if (w.type === "dragon_storm") {
          if (g.enemies.length === 0) return;
          w._fireCount = (w._fireCount || 0) + 1;
          if (w._fireCount % 3 === 1) sfx("dragonstorm");
          let nearest = null, nearestDist = w.range;
          for (const e of g.enemies) {
            const d2 = Math.sqrt((e.x - p.x) ** 2 + (e.y - p.y) ** 2);
            if (d2 < nearestDist) {
              nearest = e;
              nearestDist = d2;
            }
          }
          if (!nearest) return;
          const dx = nearest.x - p.x;
          const dy = nearest.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          for (let i = 0; i < w.count; i++) {
            const spread = (i - (w.count - 1) / 2) * 0.2;
            const cos = Math.cos(spread), sin = Math.sin(spread);
            const fx = dx / d * cos - dy / d * sin;
            const fy = dx / d * sin + dy / d * cos;
            g.projectiles.push({
              x: p.x + fx * 20,
              y: p.y + fy * 20,
              vx: fx * w.speed,
              vy: fy * w.speed,
              speed: w.speed,
              damage: w.damage,
              range: w.range,
              dist: 0,
              pierce: w.pierce,
              radius: 7,
              color: w.color
            });
          }
        }
      }
      function damageEnemy(g, e, idx, dmg) {
        if (e.dying) return;
        e.hp -= dmg;
        e.hitFlash = 1;
        if (dmg >= 5) {
          sfx("hit");
          g.floatingTexts.push({
            x: e.x + (Math.random() - 0.5) * 10,
            y: e.y - e.radius - 4,
            text: Math.floor(dmg).toString(),
            color: "#f1c40f",
            life: 0.5,
            maxLife: 0.5,
            vy: -40
          });
        }
        if (e.hp <= 0 && !e.dying) {
          sfx("kill");
          spawnGem(e.x, e.y, e.xp);
          spawnParticles(e.x, e.y, e.color, 6);
          e.dying = 0.2;
          g.kills++;
        }
      }
      function showLevelUp(g) {
        sfx("levelup");
        paused = true;
        const available = POWERUPS.filter((p) => {
          if (p.stack >= p.max) return false;
          if (p.hidden) return false;
          if (p.requires) {
            const req = POWERUPS.find((r) => r.id === p.requires);
            if (!req || req.stack === 0) return false;
          }
          return true;
        });
        const shuffled = available.sort(() => Math.random() - 0.5);
        const choices = shuffled.slice(0, 3);
        const container = document.getElementById("level-choices");
        container.innerHTML = "";
        document.getElementById("level-up").style.display = "flex";
        window._levelChoices = [];
        for (let ci = 0; ci < choices.length; ci++) {
          const choice = choices[ci];
          const div = document.createElement("div");
          div.className = "choice";
          div.innerHTML = `
      <div class="name"><span style="color:#555;font-size:0.6rem">[${ci + 1}]</span> ${choice.icon} ${choice.name}</div>
      <div class="desc">${choice.desc}</div>
    `;
          const pick = () => {
            choice.stack++;
            choice.apply(g);
            document.getElementById("level-up").style.display = "none";
            paused = false;
            window._levelChoices = [];
          };
          div.onclick = pick;
          window._levelChoices.push(pick);
          container.appendChild(div);
        }
        if (choices.length === 0) {
          document.getElementById("level-up").style.display = "none";
          paused = false;
        }
      }
      function showDeathScreen(g) {
        fadeOutMusic();
        track({ type: "death", wave: g.wave, kills: g.kills, weapons: g.player.weapons.map((w) => w.type) });
        const mins = Math.floor(g.time / 60);
        const secs = Math.floor(g.time % 60);
        const weaponList = g.player.weapons.map((w) => WEAPON_ICONS[w.type] || "?").join(" ");
        const powerupList = POWERUPS.filter((p) => p.stack > 0 && !p.id.startsWith("weapon_")).map((p) => `${p.icon}\xD7${p.stack}`).join(" ");
        document.getElementById("death-stats").innerHTML = `
    Survived: ${mins}:${secs.toString().padStart(2, "0")}<br>
    Level: ${g.player.level} \xB7 Wave: ${g.wave}<br>
    Kills: ${g.kills}<br>
    <div style="margin-top:8px;font-size:0.7rem;color:#666">Weapons: ${weaponList}</div>
    ${powerupList ? `<div style="font-size:0.65rem;color:#555">Powerups: ${powerupList}</div>` : ""}
  `;
        const loadoutEl = document.getElementById("death-loadout");
        const owned = POWERUPS.filter((p) => p.stack > 0);
        if (owned.length > 0) {
          loadoutEl.innerHTML = owned.map((p) => {
            const stackStr = p.stack > 1 ? ` \xD7${p.stack}` : "";
            return `<div class="loadout-item"><span class="li-icon">${p.icon}</span>${p.name}${stackStr}</div>`;
          }).join("");
        } else {
          loadoutEl.innerHTML = '<div class="loadout-item" style="color:#555">no powerups</div>';
        }
        document.getElementById("death-screen").style.display = "flex";
      }
      function render() {
        const W = canvas.width;
        const H = canvas.height;
        const g = game;
        if (!g) return;
        ctx.save();
        ctx.fillStyle = "#0a0a0f";
        ctx.fillRect(0, 0, W, H);
        let cx = g.camera.x - W / 2;
        let cy = g.camera.y - H / 2;
        if (g.screenShake > 0) {
          cx += (Math.random() - 0.5) * 8;
          cy += (Math.random() - 0.5) * 8;
        }
        cx = Math.round(cx);
        cy = Math.round(cy);
        ctx.translate(-cx, -cy);
        const gridSize = 60;
        const startX = Math.floor(cx / gridSize) * gridSize;
        const startY = Math.floor(cy / gridSize) * gridSize;
        ctx.strokeStyle = "#12121a";
        ctx.lineWidth = 1;
        for (let x = startX; x < cx + W + gridSize; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, cy);
          ctx.lineTo(x, cy + H);
          ctx.stroke();
        }
        for (let y = startY; y < cy + H + gridSize; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(cx, y);
          ctx.lineTo(cx + W, y);
          ctx.stroke();
        }
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
        for (const gem of g.gems) {
          if (!drawSprite("gem", gem.x, gem.y, 0.9, 0.85)) {
            ctx.fillStyle = "#3498db";
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.moveTo(gem.x, gem.y - gem.radius);
            ctx.lineTo(gem.x + gem.radius, gem.y);
            ctx.lineTo(gem.x, gem.y + gem.radius);
            ctx.lineTo(gem.x - gem.radius, gem.y);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
        const p = g.player;
        for (const w of p.weapons) {
          if (w.type === "breath") {
            const pulse = 1 + Math.sin(w.pulsePhase) * 0.1;
            const r = w.radius * pulse;
            const grad = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r);
            grad.addColorStop(0, "rgba(230, 126, 34, 0.15)");
            grad.addColorStop(0.7, "rgba(230, 126, 34, 0.08)");
            grad.addColorStop(1, "rgba(230, 126, 34, 0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(230, 126, 34, 0.3)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();
            const numDots = 8;
            const phase = w.pulsePhase * 0.7;
            for (let i = 0; i < numDots; i++) {
              const a = phase + Math.PI * 2 / numDots * i;
              const dotR = 3 + Math.sin(w.pulsePhase * 2 + i) * 1.5;
              ctx.globalAlpha = 0.6 + Math.sin(w.pulsePhase + i * 0.8) * 0.3;
              ctx.fillStyle = "#e67e22";
              ctx.beginPath();
              ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, dotR, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.globalAlpha = 1;
          }
          if (w.type === "dragon_storm") {
            const pulse = 1 + Math.sin(w.pulsePhase || 0) * 0.1;
            const r = w.auraRadius * pulse;
            const grad = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
            grad.addColorStop(0, "rgba(243, 156, 18, 0.2)");
            grad.addColorStop(0.6, "rgba(231, 76, 60, 0.1)");
            grad.addColorStop(1, "rgba(231, 76, 60, 0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(243, 156, 18, 0.4)";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          if (w.type === "orbit") {
            for (let b = 0; b < w.bladeCount; b++) {
              const angle = (w.phase || 0) + b * Math.PI * 2 / w.bladeCount;
              const bx = p.x + Math.cos(angle) * w.radius;
              const by = p.y + Math.sin(angle) * w.radius;
              ctx.save();
              ctx.translate(bx, by);
              ctx.rotate(angle + Math.PI / 2);
              ctx.fillStyle = w.color;
              ctx.shadowColor = w.color;
              ctx.shadowBlur = 6;
              ctx.beginPath();
              ctx.moveTo(0, -10);
              ctx.lineTo(4, 4);
              ctx.lineTo(-4, 4);
              ctx.closePath();
              ctx.fill();
              ctx.shadowBlur = 0;
              ctx.restore();
            }
          }
          if (w.type === "shield") {
            const pulse = 1 + Math.sin(w.phase) * 0.08;
            const r = w.radius * pulse;
            const grad = ctx.createRadialGradient(p.x, p.y, r * 0.7, p.x, p.y, r);
            grad.addColorStop(0, "rgba(116, 185, 255, 0)");
            grad.addColorStop(0.8, "rgba(116, 185, 255, 0.12)");
            grad.addColorStop(1, "rgba(116, 185, 255, 0.25)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(116, 185, 255, 0.6)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();
            const hexCount = 6;
            for (let h = 0; h < hexCount; h++) {
              const a = w.phase * 0.5 + Math.PI * 2 / hexCount * h;
              ctx.fillStyle = "rgba(116, 185, 255, 0.8)";
              ctx.beginPath();
              ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          if (w.type === "lightning_field") {
            ctx.strokeStyle = "rgba(255, 234, 167, 0.15)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 8]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, w.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        for (const ce of g.chainEffects || []) {
          ctx.strokeStyle = ce.color;
          ctx.lineWidth = 2;
          ctx.shadowColor = ce.color;
          ctx.shadowBlur = 10;
          ctx.globalAlpha = ce.life / 0.2;
          for (let i = 0; i < ce.points.length - 1; i++) {
            const a = ce.points[i];
            const b = ce.points[i + 1];
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            const mx = (a.x + b.x) / 2 + (Math.random() - 0.5) * 20;
            const my = (a.y + b.y) / 2 + (Math.random() - 0.5) * 20;
            ctx.lineTo(mx, my);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
        }
        for (const m of g.meteorEffects || []) {
          if (m.phase === "warn") {
            ctx.strokeStyle = "rgba(255, 99, 72, 0.5)";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = `rgba(255, 99, 72, ${0.1 + Math.sin(m.life * 20) * 0.1})`;
            ctx.beginPath();
            ctx.arc(m.x, m.y, m.radius * 0.5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const t = m.life / 0.3;
            ctx.fillStyle = `rgba(255, 99, 72, ${t * 0.4})`;
            ctx.beginPath();
            ctx.arc(m.x, m.y, m.radius * (2 - t), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        for (const e of g.enemies) {
          if (e.x < cx - 50 || e.x > cx + W + 50 || e.y < cy - 50 || e.y > cy + H + 50) continue;
          if (e.dying !== void 0) {
            const t = e.dying / 0.2;
            const dyingScale = (0.3 + t * 0.7) * (e.radius / 8);
            const spriteName2 = e.sprite || "blob";
            if (!drawSprite(spriteName2, e.x, e.y, dyingScale, t)) {
              const prev = ctx.globalAlpha;
              ctx.globalAlpha = t;
              ctx.fillStyle = "#fff";
              ctx.beginPath();
              ctx.arc(e.x, e.y, e.radius * (0.3 + t * 0.7), 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = prev;
            }
            continue;
          }
          const spriteScale = e.radius / 8;
          const spriteName = e.sprite || "blob";
          if (e.hitFlash > 0) {
            if (!drawSprite(spriteName, e.x, e.y, spriteScale)) {
              ctx.fillStyle = e.color;
              ctx.beginPath();
              ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = `rgba(255,255,255,${Math.min(e.hitFlash * 5, 0.6)})`;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius * 0.8, 0, Math.PI * 2);
            ctx.fill();
          } else if (!drawSprite(spriteName, e.x, e.y, spriteScale)) {
            ctx.fillStyle = e.color;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.fill();
          }
          if (e.hp < e.maxHp) {
            const bw = e.radius * 2;
            ctx.fillStyle = "#300";
            ctx.fillRect(e.x - bw / 2, e.y - e.radius - 8, bw, 3);
            ctx.fillStyle = e.hp / e.maxHp > 0.3 ? "#2ecc71" : "#e74c3c";
            ctx.fillRect(e.x - bw / 2, e.y - e.radius - 8, bw * (e.hp / e.maxHp), 3);
          }
        }
        for (const proj of g.projectiles) {
          const trailLen = 4;
          const speed = Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);
          if (speed > 0) {
            const nx = -proj.vx / speed;
            const ny = -proj.vy / speed;
            for (let t = 1; t <= trailLen; t++) {
              const alpha = 0.3 - t * 0.06;
              const tScale = (1 - t * 0.15) * 0.7;
              if (!drawSprite("spitTrail", proj.x + nx * t * 6, proj.y + ny * t * 6, tScale, alpha)) {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = proj.color;
                ctx.beginPath();
                ctx.arc(proj.x + nx * t * 6, proj.y + ny * t * 6, proj.radius * (1 - t * 0.15), 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
              }
            }
          }
          ctx.shadowColor = proj.color;
          ctx.shadowBlur = 10;
          if (!drawSprite("spit", proj.x, proj.y, 0.7)) {
            ctx.fillStyle = proj.color;
            ctx.beginPath();
            ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.shadowBlur = 0;
        }
        for (const w of p.weapons) {
          if (w.type === "charge" && w.active) {
            const trailDist = w.speed * w.duration;
            const progress = 1 - w.chargeTimer / w.duration;
            const perpX = -w.chargeDy;
            const perpY = w.chargeDx;
            ctx.save();
            const steps = 10;
            for (let t = steps; t >= 0; t--) {
              const frac = t / steps;
              const tx = p.x - w.chargeDx * trailDist * frac;
              const ty = p.y - w.chargeDy * trailDist * frac;
              const alpha = 0.35 * (1 - frac);
              const size = w.width * (1 - frac * 0.6);
              ctx.globalAlpha = alpha;
              ctx.fillStyle = w.color;
              ctx.beginPath();
              ctx.arc(tx, ty, size, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.strokeStyle = w.color;
            ctx.lineWidth = 2;
            for (let i = 0; i < 4; i++) {
              const offset = (i + 1) * 0.2;
              const spread = (i % 2 === 0 ? 1 : -1) * (8 + i * 6);
              const sx = p.x - w.chargeDx * trailDist * offset + perpX * spread;
              const sy = p.y - w.chargeDy * trailDist * offset + perpY * spread;
              const lineLen = 12 + i * 4;
              ctx.globalAlpha = 0.4 * (1 - offset);
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(sx - w.chargeDx * lineLen, sy - w.chargeDy * lineLen);
              ctx.stroke();
            }
            ctx.globalAlpha = 0.5 * (1 - progress);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 3;
            const slashAngle = Math.atan2(w.chargeDy, w.chargeDx);
            ctx.beginPath();
            ctx.arc(p.x, p.y, w.width * 1.5, slashAngle - 0.8, slashAngle + 0.8);
            ctx.stroke();
            ctx.restore();
          }
        }
        if (p.alive) {
          const flickerHide = p.iframes > 0 && Math.floor(p.iframes * 10) % 2;
          const playerAlpha = flickerHide ? 0.4 : 1;
          ctx.shadowColor = p.iframes > 0 ? "#fff" : "#3498db";
          ctx.shadowBlur = 15;
          if (!drawSprite("player", p.x, p.y, 2, playerAlpha)) {
            ctx.fillStyle = flickerHide ? "rgba(255,255,255,0.5)" : "#eee";
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#3498db";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
          const fd = Math.sqrt(p.facing.x ** 2 + p.facing.y ** 2);
          if (fd > 0.01) {
            const fx = p.facing.x / fd;
            const fy = p.facing.y / fd;
            const tipX = p.x + fx * (p.radius + 6);
            const tipY = p.y + fy * (p.radius + 6);
            const perpX = -fy;
            const perpY = fx;
            ctx.fillStyle = "#3498db";
            ctx.globalAlpha = playerAlpha;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(p.x + fx * p.radius - perpX * 4, p.y + fy * p.radius - perpY * 4);
            ctx.lineTo(p.x + fx * p.radius + perpX * 4, p.y + fy * p.radius + perpY * 4);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = "#fff";
          ctx.font = 'bold 9px "Chakra Petch", sans-serif';
          ctx.textAlign = "center";
          ctx.globalAlpha = 0.8;
          ctx.fillText(g.playerName, p.x, p.y - p.radius - 16);
          ctx.globalAlpha = 1;
          const bw = 30;
          ctx.fillStyle = "#222";
          ctx.fillRect(p.x - bw / 2, p.y - p.radius - 10, bw, 4);
          ctx.fillStyle = p.hp / p.maxHp > 0.3 ? "#2ecc71" : "#e74c3c";
          ctx.fillRect(p.x - bw / 2, p.y - p.radius - 10, bw * (p.hp / p.maxHp), 4);
        }
        for (const pt of g.particles) {
          ctx.globalAlpha = pt.life / pt.maxLife;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.radius * (pt.life / pt.maxLife), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        for (const ft of g.floatingTexts) {
          ctx.globalAlpha = ft.life / ft.maxLife;
          ctx.fillStyle = ft.color;
          ctx.font = 'bold 12px "Chakra Petch", sans-serif';
          ctx.textAlign = "center";
          ctx.fillText(ft.text, ft.x, ft.y);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        if (g.waveMsgTimer > 0) {
          const alpha = Math.min(1, g.waveMsgTimer / 0.5);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "#f1c40f";
          ctx.font = 'bold 28px "Orbitron", sans-serif';
          ctx.textAlign = "center";
          ctx.shadowColor = "#f39c12";
          ctx.shadowBlur = 15;
          ctx.fillText(g.waveMsg, W / 2, H * 0.3);
          ctx.shadowBlur = 0;
          ctx.restore();
        }
        if (g.specialWaveMsgTimer > 0) {
          const alpha = Math.min(1, g.specialWaveMsgTimer / 0.5);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "#e74c3c";
          ctx.font = 'bold 36px "Orbitron", sans-serif';
          ctx.textAlign = "center";
          ctx.shadowColor = "#e74c3c";
          ctx.shadowBlur = 20;
          ctx.fillText(`\u26A0 ${g.specialWaveMsg} \u26A0`, W / 2, H * 0.3 + 44);
          ctx.shadowBlur = 0;
          ctx.restore();
        }
        const feedMax = 5;
        const feedDuration = 6;
        const recentFeed = g.deathFeed.slice(-feedMax);
        for (let i = 0; i < recentFeed.length; i++) {
          const entry = recentFeed[i];
          const age = g.time - entry.time;
          if (age > feedDuration) continue;
          const alpha = age > feedDuration - 1 ? feedDuration - age : 1;
          ctx.save();
          ctx.globalAlpha = alpha * 0.7;
          ctx.fillStyle = "#ccc";
          ctx.font = '10px "Chakra Petch", sans-serif';
          ctx.textAlign = "left";
          ctx.fillText(entry.text, 12, H - 20 - (recentFeed.length - 1 - i) * 16);
          ctx.restore();
        }
        const mins = Math.floor(g.time / 60);
        const secs = Math.floor(g.time % 60);
        setHud("time", `${mins}:${secs.toString().padStart(2, "0")}`);
        setHud("level", `Lv ${p.level}`);
        setHud("kills", `${g.kills} kills`);
        setHud("wave", `Wave ${g.wave}`);
        setHud("weapons", p.weapons.map((w) => WEAPON_ICONS[w.type] || "?").join(" "));
        if (g.levelFlash > 0) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = g.levelFlash / 0.15 * 0.3;
          ctx.fillStyle = "#f1c40f";
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
      }
      var KEY_MAP = {
        "w": "up",
        "arrowup": "up",
        "s": "down",
        "arrowdown": "down",
        "a": "left",
        "arrowleft": "left",
        "d": "right",
        "arrowright": "right"
      };
      document.addEventListener("keydown", (e) => {
        if (paused && window._levelChoices && window._levelChoices.length > 0) {
          const num = parseInt(e.key);
          if (num >= 1 && num <= window._levelChoices.length) {
            window._levelChoices[num - 1]();
            e.preventDefault();
            return;
          }
        }
        if (document.activeElement && document.activeElement.tagName === "INPUT") return;
        const k = KEY_MAP[e.key.toLowerCase()];
        if (k) {
          keys[k] = true;
          e.preventDefault();
        }
      });
      document.addEventListener("keyup", (e) => {
        if (document.activeElement && document.activeElement.tagName === "INPUT") return;
        const k = KEY_MAP[e.key.toLowerCase()];
        if (k) {
          keys[k] = false;
          e.preventDefault();
        }
      });
      function clearAllInput() {
        keys.up = keys.down = keys.left = keys.right = false;
        analogMove.x = 0;
        analogMove.y = 0;
      }
      window.addEventListener("blur", clearAllInput);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) clearAllInput();
      });
      var joyZone = document.getElementById("joystick-zone");
      var touchHint = document.getElementById("touch-hint");
      var joyTouchId = null;
      var joyOrigin = null;
      var hintShown = false;
      var JOY_DEAD = 15;
      joyZone.addEventListener("touchstart", (e) => {
        if (joyTouchId !== null) return;
        const t = e.changedTouches[0];
        joyTouchId = t.identifier;
        joyOrigin = { x: t.clientX, y: t.clientY };
        if (!hintShown && touchHint) {
          hintShown = true;
          touchHint.style.opacity = "0";
          setTimeout(() => {
            touchHint.style.display = "none";
          }, 1e3);
        }
        e.preventDefault();
      }, { passive: false });
      joyZone.addEventListener("touchmove", (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== joyTouchId) continue;
          const dx = t.clientX - joyOrigin.x;
          const dy = t.clientY - joyOrigin.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > JOY_DEAD) {
            const mag = Math.min(dist / 60, 1);
            analogMove.x = dx / dist * mag;
            analogMove.y = dy / dist * mag;
            keys.left = analogMove.x < -0.3;
            keys.right = analogMove.x > 0.3;
            keys.up = analogMove.y < -0.3;
            keys.down = analogMove.y > 0.3;
          } else {
            analogMove.x = analogMove.y = 0;
            keys.left = keys.right = keys.up = keys.down = false;
          }
        }
        e.preventDefault();
      }, { passive: false });
      function joyEnd(e) {
        for (const t of e.changedTouches) {
          if (t.identifier !== joyTouchId) continue;
          joyTouchId = null;
          joyOrigin = null;
          analogMove.x = analogMove.y = 0;
          keys.left = keys.right = keys.up = keys.down = false;
        }
      }
      joyZone.addEventListener("touchend", joyEnd, { passive: false });
      joyZone.addEventListener("touchcancel", joyEnd, { passive: false });
      document.addEventListener("touchmove", (e) => {
        if (e.target === canvas || e.target === joyZone || joyZone.contains(e.target)) {
          e.preventDefault();
        }
      }, { passive: false });
      var lastTap = 0;
      document.addEventListener("touchend", (e) => {
        const now = Date.now();
        if (now - lastTap < 300) e.preventDefault();
        lastTap = now;
      }, { passive: false });
      document.addEventListener("contextmenu", (e) => e.preventDefault());
      var lastTime = 0;
      function gameLoop(ts) {
        if (lastTime === 0) lastTime = ts;
        const dt = Math.min((ts - lastTime) / 1e3, 0.05);
        lastTime = ts;
        update(dt);
        render();
        requestAnimationFrame(gameLoop);
      }
      function startGame() {
        document.getElementById("start-screen").style.display = "none";
        document.getElementById("death-screen").style.display = "none";
        document.getElementById("level-up").style.display = "none";
        paused = false;
        game = initGame();
        const nameEl = document.getElementById("name-input");
        if (nameEl && nameEl.value.trim()) game.playerName = nameEl.value.trim();
        startMusic();
        track({ type: "game_start" });
        if (!gameStarted) {
          gameStarted = true;
          lastTime = 0;
          requestAnimationFrame(gameLoop);
        }
      }
      document.addEventListener("keydown", (e) => {
        const startScreen = document.getElementById("start-screen");
        const deathScreen = document.getElementById("death-screen");
        const startVisible = startScreen.style.display !== "none" && startScreen.offsetParent !== null;
        const deathVisible = deathScreen.style.display === "flex";
        if (startVisible) {
          if (e.key === "1") selectWeapon("spit");
          else if (e.key === "2") selectWeapon("breath");
          else if (e.key === "3") selectWeapon("charge");
          else if (e.key === "Enter" || e.key === " ") {
            startGame();
            e.preventDefault();
          }
        }
        if (deathVisible) {
          if (e.key === "Enter" || e.key === " ") {
            startGame();
            e.preventDefault();
          }
        }
      });
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        window._dev = {
          spawnEnemies: (n) => {
            if (game) for (let i = 0; i < n; i++) spawnEnemy(game);
          },
          spawnParticles: (x, y, n) => spawnParticles(x, y, "#ff0", n),
          getStats: () => game ? { enemies: game.enemies.length, projectiles: game.projectiles.length, particles: game.particles.length, gems: game.gems.length } : null,
          getGame: () => game
        };
      }
      window.startGame = startGame;
      window.selectWeapon = selectWeapon;
    }
  });
  require_main();
})();
//# sourceMappingURL=bundle.js.map
