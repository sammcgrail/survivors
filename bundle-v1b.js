(() => {
  // src/shared/sprites.js
  var SPRITE_SIZE = 16;
  var SP = {
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

  // src/shared/weapons.js
  var WEAPON_ICONS = {
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

  // src/v1b-main.js
  var canvas = document.getElementById("c");
  var ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  var spriteSheet = new Image();
  spriteSheet.src = "sprites.png";
  var spritesReady = false;
  spriteSheet.onload = () => {
    spritesReady = true;
  };
  var ENEMY_SPRITES = {
    blob: "blob",
    fast: "fast",
    tank: "tank",
    swarm: "swarm",
    brute: "tank",
    ghost: "skull"
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
        default:
          gain.gain.setValueAtTime(0, t);
          osc.start(t);
          osc.stop(t + 0.01);
      }
    } catch (e) {
    }
  }
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();
  var ws = null;
  var myId = null;
  var myName = "";
  var myColor = "#eee";
  var selectedWeapon = "spit";
  var connected = false;
  var arena = { w: 3e3, h: 3e3 };
  var prevState = null;
  var currState = null;
  var stateTime = 0;
  var interpAlpha = 1;
  var TICK_DT = 1 / 20;
  var particles = [];
  var floatingTexts = [];
  var deathFeed = [];
  var screenShake = 0;
  var prevMyHp = null;
  var prevMyAlive = null;
  var prevMyLevel = null;
  var prevEnemyCount = 0;
  var prevGemCount = 0;
  var camera = { x: 1500, y: 1500 };
  var spectateIdx = 0;
  var keys = { up: false, down: false, left: false, right: false };
  var lastSentKeys = null;
  function selectWeapon(type) {
    selectedWeapon = type;
    document.querySelectorAll(".weapon-card").forEach((c) => {
      c.classList.toggle("selected", c.dataset.weapon === type);
    });
  }
  function connectWS() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const host = location.host || "localhost:7700";
    const url = proto + "//" + host + "/ws";
    const connStatus = document.getElementById("conn-status");
    connStatus.style.display = "block";
    connStatus.textContent = "CONNECTING...";
    ws = new WebSocket(url);
    ws.onopen = () => {
      connected = true;
      connStatus.style.display = "none";
      console.log("[ws] connected");
    };
    ws.onclose = () => {
      connected = false;
      ws = null;
      connStatus.style.display = "block";
      connStatus.textContent = "DISCONNECTED \u2014 reconnecting...";
      console.log("[ws] disconnected, reconnecting in 2s");
      setTimeout(connectWS, 2e3);
    };
    ws.onerror = () => {
    };
    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch (e) {
        return;
      }
      if (msg.type === "welcome") {
        myId = msg.you;
        myName = msg.name;
        myColor = msg.color;
        arena = msg.arena || arena;
        console.log(`[ws] welcome: id=${myId}, name=${myName}`);
        return;
      }
      if (msg.type === "state") {
        prevState = currState;
        currState = msg;
        stateTime = performance.now();
        interpAlpha = 0;
        arena = msg.arena || arena;
        processStateChanges(msg);
        return;
      }
    };
  }
  function processStateChanges(state) {
    const me = state.players.find((p) => p.id === myId);
    if (!me) return;
    if (prevMyHp !== null && me.hp < prevMyHp && me.alive) {
      sfx("playerhit");
      screenShake = 0.15;
      spawnParticles(me.x, me.y, "#e74c3c", 5);
    }
    if (prevMyAlive === true && !me.alive) {
      sfx("death");
      showDeathScreen(state, me);
    }
    if (prevMyLevel !== null && me.level > prevMyLevel) {
      sfx("levelup");
    }
    if (state.gems.length < prevGemCount && prevGemCount - state.gems.length <= 3) {
      sfx("xp");
    }
    const enemyDelta = prevEnemyCount - state.enemies.length;
    if (enemyDelta > 0 && enemyDelta <= 5) {
      sfx("kill");
    }
    prevMyHp = me.hp;
    prevMyAlive = me.alive;
    prevMyLevel = me.level;
    prevEnemyCount = state.enemies.length;
    prevGemCount = state.gems.length;
  }
  function sendInput() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const k = JSON.stringify(keys);
    if (k === lastSentKeys) return;
    lastSentKeys = k;
    ws.send(JSON.stringify({ type: "input", keys: { ...keys } }));
  }
  function joinGame() {
    const nameInput = document.getElementById("name-input");
    const name = (nameInput.value || "").trim().slice(0, 12) || "player";
    myName = name;
    document.getElementById("start-screen").style.display = "none";
    document.getElementById("death-screen").style.display = "none";
    if (!connected) {
      connectWS();
      const waitJoin = setInterval(() => {
        if (connected && ws && ws.readyState === WebSocket.OPEN) {
          clearInterval(waitJoin);
          ws.send(JSON.stringify({ type: "join", name: myName, weapon: selectedWeapon }));
        }
      }, 100);
    } else {
      ws.send(JSON.stringify({ type: "join", name: myName, weapon: selectedWeapon }));
    }
    if (!renderStarted) {
      renderStarted = true;
      requestAnimationFrame(mainLoop);
    }
  }
  function respawnGame() {
    document.getElementById("death-screen").style.display = "none";
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "respawn", weapon: selectedWeapon }));
    }
    prevMyAlive = null;
    prevMyHp = null;
    prevMyLevel = null;
  }
  function showDeathScreen(state, me) {
    const mins = Math.floor(state.time / 60);
    const secs = Math.floor(state.time % 60);
    const weaponList = (me.weapons || []).map((w) => WEAPON_ICONS[w] || "?").join(" ");
    document.getElementById("death-stats").innerHTML = `
    Survived: ${mins}:${secs.toString().padStart(2, "0")}<br>
    Level: ${me.level} \xB7 Wave: ${state.wave}<br>
    Kills: ${me.kills}<br>
    <div style="margin-top:8px;font-size:0.7rem;color:#666">Weapons: ${weaponList}</div>
  `;
    document.getElementById("death-screen").style.display = "flex";
  }
  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 150;
      particles.push({
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
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
      if (pt.life <= 0) particles.splice(i, 1);
    }
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.life -= dt;
      if (ft.life <= 0) floatingTexts.splice(i, 1);
    }
    if (screenShake > 0) screenShake -= dt;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function lerpState(prev, curr, t) {
    if (!prev || !curr) return curr;
    t = Math.min(1, Math.max(0, t));
    const result = { ...curr };
    result.players = curr.players.map((cp) => {
      const pp = prev.players.find((p) => p.id === cp.id);
      if (!pp) return cp;
      return {
        ...cp,
        x: lerp(pp.x, cp.x, t),
        y: lerp(pp.y, cp.y, t),
        hp: lerp(pp.hp, cp.hp, t)
      };
    });
    if (prev.enemies.length === curr.enemies.length) {
      result.enemies = curr.enemies.map((ce, i) => {
        const pe = prev.enemies[i];
        if (!pe || pe.name !== ce.name) return ce;
        return {
          ...ce,
          x: lerp(pe.x, ce.x, t),
          y: lerp(pe.y, ce.y, t)
        };
      });
    }
    if (prev.gems.length === curr.gems.length) {
      result.gems = curr.gems.map((cg, i) => {
        const pg = prev.gems[i];
        if (!pg) return cg;
        return {
          ...cg,
          x: lerp(pg.x, cg.x, t),
          y: lerp(pg.y, cg.y, t)
        };
      });
    }
    return result;
  }
  var renderStarted = false;
  var lastFrameTime = 0;
  function mainLoop(ts) {
    const dt = Math.min((ts - lastFrameTime) / 1e3, 0.05);
    lastFrameTime = ts;
    if (currState) {
      const elapsed = (performance.now() - stateTime) / 1e3;
      interpAlpha = Math.min(elapsed / TICK_DT, 1);
    }
    sendInput();
    updateParticles(dt);
    render(dt);
    requestAnimationFrame(mainLoop);
  }
  function render(dt) {
    const W = canvas.width;
    const H = canvas.height;
    if (!currState) {
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, W, H);
      requestAnimationFrame(mainLoop);
      return;
    }
    const state = lerpState(prevState, currState, interpAlpha);
    const me = state.players.find((p) => p.id === myId);
    let camTarget;
    if (me && me.alive) {
      camTarget = { x: me.x, y: me.y };
    } else {
      const alive = state.players.filter((p) => p.alive);
      if (alive.length > 0) {
        spectateIdx = spectateIdx % alive.length;
        camTarget = { x: alive[spectateIdx].x, y: alive[spectateIdx].y };
      } else {
        camTarget = { x: arena.w / 2, y: arena.h / 2 };
      }
    }
    const camSmooth = 1 - Math.exp(-12 * dt);
    camera.x += (camTarget.x - camera.x) * camSmooth;
    camera.y += (camTarget.y - camera.y) * camSmooth;
    ctx.save();
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, W, H);
    let cx = camera.x - W / 2;
    let cy = camera.y - H / 2;
    if (screenShake > 0) {
      cx += (Math.random() - 0.5) * 8;
      cy += (Math.random() - 0.5) * 8;
    }
    ctx.translate(-Math.round(cx), -Math.round(cy));
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
    ctx.strokeRect(0, 0, arena.w, arena.h);
    for (const gem of state.gems) {
      if (gem.x < cx - 20 || gem.x > cx + W + 20 || gem.y < cy - 20 || gem.y > cy + H + 20) continue;
      if (!drawSprite("gem", gem.x, gem.y, 0.9, 0.85)) {
        ctx.fillStyle = "#3498db";
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        const r = 6;
        ctx.moveTo(gem.x, gem.y - r);
        ctx.lineTo(gem.x + r, gem.y);
        ctx.lineTo(gem.x, gem.y + r);
        ctx.lineTo(gem.x - r, gem.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    const gameTime = state.time || 0;
    for (const pl of state.players) {
      if (!pl.alive) continue;
      for (const wtype of pl.weapons || []) {
        if (wtype === "breath") {
          const pulse = 1 + Math.sin(gameTime * 3) * 0.1;
          const r = 80 * pulse;
          const grad = ctx.createRadialGradient(pl.x, pl.y, r * 0.3, pl.x, pl.y, r);
          grad.addColorStop(0, "rgba(230, 126, 34, 0.15)");
          grad.addColorStop(0.7, "rgba(230, 126, 34, 0.08)");
          grad.addColorStop(1, "rgba(230, 126, 34, 0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(230, 126, 34, 0.3)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
          ctx.stroke();
          const numDots = 8;
          const phase = gameTime * 2.1;
          for (let i = 0; i < numDots; i++) {
            const a = phase + Math.PI * 2 / numDots * i;
            const dotR = 3 + Math.sin(gameTime * 2 + i) * 1.5;
            ctx.globalAlpha = 0.6 + Math.sin(gameTime + i * 0.8) * 0.3;
            ctx.fillStyle = "#e67e22";
            ctx.beginPath();
            ctx.arc(pl.x + Math.cos(a) * r, pl.y + Math.sin(a) * r, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        if (wtype === "dragon_storm") {
          const pulse = 1 + Math.sin(gameTime * 4) * 0.1;
          const r = 100 * pulse;
          const grad = ctx.createRadialGradient(pl.x, pl.y, r * 0.2, pl.x, pl.y, r);
          grad.addColorStop(0, "rgba(243, 156, 18, 0.2)");
          grad.addColorStop(0.6, "rgba(231, 76, 60, 0.1)");
          grad.addColorStop(1, "rgba(231, 76, 60, 0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(243, 156, 18, 0.4)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (wtype === "orbit") {
          const bladeCount = 2;
          const orbitRadius = 70;
          const phase = gameTime * 3;
          for (let b = 0; b < bladeCount; b++) {
            const angle = phase + b * Math.PI * 2 / bladeCount;
            const bx = pl.x + Math.cos(angle) * orbitRadius;
            const by = pl.y + Math.sin(angle) * orbitRadius;
            ctx.save();
            ctx.translate(bx, by);
            ctx.rotate(angle + Math.PI / 2);
            ctx.fillStyle = "#ecf0f1";
            ctx.shadowColor = "#ecf0f1";
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
      }
    }
    for (const e of state.enemies) {
      if (e.x < cx - 50 || e.x > cx + W + 50 || e.y < cy - 50 || e.y > cy + H + 50) continue;
      const spriteScale = e.radius / 8;
      const spriteName = ENEMY_SPRITES[e.name] || "blob";
      if (e.hitFlash > 0) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
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
    for (const proj of state.projectiles) {
      if (proj.x < cx - 30 || proj.x > cx + W + 30 || proj.y < cy - 30 || proj.y > cy + H + 30) continue;
      let projColor = "#9b59b6";
      const owner = state.players.find((p) => p.id === proj.owner);
      if (owner) projColor = owner.color;
      ctx.shadowColor = projColor;
      ctx.shadowBlur = 10;
      if (!drawSprite("spit", proj.x, proj.y, 0.7)) {
        ctx.fillStyle = projColor;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, proj.radius || 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    for (const pl of state.players) {
      if (!pl.alive) continue;
      if (pl.x < cx - 60 || pl.x > cx + W + 60 || pl.y < cy - 60 || pl.y > cy + H + 60) continue;
      const isMe = pl.id === myId;
      const playerRadius = 14;
      ctx.shadowColor = isMe ? "#3498db" : pl.color;
      ctx.shadowBlur = isMe ? 15 : 8;
      if (!drawSprite("player", pl.x, pl.y, 2)) {
        ctx.fillStyle = pl.color;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, playerRadius, 0, Math.PI * 2);
        ctx.fill();
        if (isMe) {
          ctx.strokeStyle = "#3498db";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      if (isMe) {
        ctx.fillStyle = "#3498db";
        ctx.globalAlpha = 0.7 + Math.sin(gameTime * 4) * 0.3;
        ctx.beginPath();
        const ay = pl.y - playerRadius - 28;
        ctx.moveTo(pl.x, ay + 6);
        ctx.lineTo(pl.x - 5, ay);
        ctx.lineTo(pl.x + 5, ay);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = isMe ? "#fff" : "#ccc";
      ctx.font = `bold 9px "Chakra Petch", sans-serif`;
      ctx.textAlign = "center";
      ctx.globalAlpha = isMe ? 1 : 0.7;
      ctx.fillText(pl.name, pl.x, pl.y - playerRadius - 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#f1c40f";
      ctx.font = 'bold 7px "Chakra Petch", sans-serif';
      ctx.globalAlpha = 0.6;
      ctx.fillText("Lv" + pl.level, pl.x, pl.y + playerRadius + 14);
      ctx.globalAlpha = 1;
      const bw = 30;
      ctx.fillStyle = "#222";
      ctx.fillRect(pl.x - bw / 2, pl.y - playerRadius - 10, bw, 4);
      ctx.fillStyle = pl.hp / pl.maxHp > 0.3 ? "#2ecc71" : "#e74c3c";
      ctx.fillRect(pl.x - bw / 2, pl.y - playerRadius - 10, bw * Math.max(0, pl.hp / pl.maxHp), 4);
    }
    for (const pt of particles) {
      ctx.globalAlpha = pt.life / pt.maxLife;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.radius * (pt.life / pt.maxLife), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const ft of floatingTexts) {
      ctx.globalAlpha = ft.life / ft.maxLife;
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 12px "Chakra Petch", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (me && !me.alive) {
      const alive = state.players.filter((p) => p.alive);
      if (alive.length > 0) {
        ctx.save();
        ctx.fillStyle = "#aaa";
        ctx.font = '12px "Chakra Petch", sans-serif';
        ctx.textAlign = "center";
        ctx.globalAlpha = 0.7;
        const specName = alive[spectateIdx % alive.length].name;
        ctx.fillText(`SPECTATING: ${specName} (click to switch)`, W / 2, H - 30);
        ctx.restore();
      }
    }
    const feedMax = 5;
    const feedDuration = 6;
    const recentFeed = deathFeed.slice(-feedMax);
    const now = performance.now() / 1e3;
    for (let i = 0; i < recentFeed.length; i++) {
      const entry = recentFeed[i];
      const age = now - entry.time;
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
    if (state) {
      const mins = Math.floor(state.time / 60);
      const secs = Math.floor(state.time % 60);
      document.getElementById("hud-time").textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
      document.getElementById("hud-players").textContent = `${state.players.length} player${state.players.length !== 1 ? "s" : ""}`;
      document.getElementById("hud-kills").textContent = `${state.kills} kills`;
      document.getElementById("hud-wave").textContent = `Wave ${state.wave}`;
      if (me) {
        document.getElementById("hud-weapons").textContent = (me.weapons || []).map((w) => WEAPON_ICONS[w] || "?").join(" ");
      }
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
        joinGame();
        e.preventDefault();
      }
    }
    if (deathVisible) {
      if (e.key === "1") selectWeapon("spit");
      else if (e.key === "2") selectWeapon("breath");
      else if (e.key === "3") selectWeapon("charge");
      else if (e.key === "Enter" || e.key === " ") {
        respawnGame();
        e.preventDefault();
      }
    }
  });
  canvas.addEventListener("click", () => {
    if (currState) {
      const me = currState.players.find((p) => p.id === myId);
      if (me && !me.alive) {
        spectateIdx++;
      }
    }
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
      const nx = dist > 0 ? dx / dist : 0;
      const ny = dist > 0 ? dy / dist : 0;
      if (dist > JOY_DEAD) {
        keys.left = nx < -0.4;
        keys.right = nx > 0.4;
        keys.up = ny < -0.4;
        keys.down = ny > 0.4;
      } else {
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
  window.addEventListener("load", () => {
    document.getElementById("name-input").focus();
  });
  window.joinGame = joinGame;
  window.respawnGame = respawnGame;
  window.selectWeapon = selectWeapon;
})();
//# sourceMappingURL=bundle-v1b.js.map
