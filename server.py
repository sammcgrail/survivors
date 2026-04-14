#!/usr/bin/env python3.11
"""survivors v1b — multiplayer server. websocket on port 7700.
server-authoritative: movement, enemies, projectiles, damage, gems.
clients send: inputs (keys), weapon choice, powerup picks.
server broadcasts full game state at 20Hz.
"""

import asyncio
import json
import time
import math
import random
import websockets

# --- config ---
PORT = 7700
TICK_RATE = 20
TICK_DT = 1.0 / TICK_RATE
WORLD_W = 3000
WORLD_H = 3000
PLAYER_SPEED = 150
PLAYER_RADIUS = 14
PLAYER_MAX_HP = 100
XP_RADIUS = 6
XP_MAGNET_RANGE = 80
XP_MAGNET_SPEED = 400
MAX_PLAYERS = 8

COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#f1c40f",
    "#9b59b6", "#e67e22", "#1abc9c", "#e84393",
]

# --- enemy definitions ---
ENEMY_TYPES = [
    {"name": "blob",  "hp": 20,  "speed": 55,  "radius": 10, "color": "#2ecc71", "damage": 8,  "xp": 10},
    {"name": "fast",  "hp": 10,  "speed": 130, "radius": 7,  "color": "#1abc9c", "damage": 4,  "xp": 8},
    {"name": "tank",  "hp": 80,  "speed": 30,  "radius": 18, "color": "#e67e22", "damage": 18, "xp": 30},
    {"name": "swarm", "hp": 6,   "speed": 85,  "radius": 5,  "color": "#fd79a8", "damage": 2,  "xp": 4},
    {"name": "brute", "hp": 150, "speed": 22,  "radius": 24, "color": "#e74c3c", "damage": 30, "xp": 60},
    {"name": "ghost", "hp": 15,  "speed": 100, "radius": 9,  "color": "#a29bfe", "damage": 6,  "xp": 12},
]

WAVE_POOLS = [
    {"maxWave": 2,   "weights": {"blob": 5, "swarm": 3}},
    {"maxWave": 4,   "weights": {"blob": 4, "swarm": 4, "fast": 2}},
    {"maxWave": 6,   "weights": {"blob": 3, "swarm": 3, "fast": 3, "tank": 1}},
    {"maxWave": 9,   "weights": {"blob": 2, "swarm": 4, "fast": 3, "tank": 2, "ghost": 2}},
    {"maxWave": 12,  "weights": {"blob": 1, "swarm": 5, "fast": 3, "tank": 3, "ghost": 2, "brute": 1}},
    {"maxWave": 999, "weights": {"blob": 1, "swarm": 6, "fast": 4, "tank": 3, "ghost": 3, "brute": 2}},
]

SPECIAL_WAVES = {
    6:  {"name": "SWARM RUSH",  "override": "swarm", "countMulti": 3},
    7:  {"name": "PHANTOM",     "override": "ghost", "countMulti": 0.5},
    9:  {"name": "TANK PARADE", "override": "tank",  "countMulti": 1.5},
    11: {"name": "GHOST STORM", "override": "ghost", "countMulti": 1.5},
    13: {"name": "BRUTE FORCE", "override": "brute", "countMulti": 1},
    15: {"name": "THE HORDE",   "override": None,    "countMulti": 4},
}

WEAPON_DEFS = {
    "spit":   {"type": "spit",   "cooldown": 0.8, "damage": 15, "speed": 350, "range": 300, "count": 1, "pierce": 1},
    "breath": {"type": "breath", "cooldown": 0.5, "damage": 8,  "radius": 80},
    "charge": {"type": "charge", "cooldown": 2.5, "damage": 40, "speed": 500, "duration": 0.3, "width": 40},
}

# --- game state ---
game = None  # shared game world
players = {}  # ws -> player dict
next_id = 0


def make_weapon(wtype):
    base = WEAPON_DEFS.get(wtype)
    if not base:
        base = WEAPON_DEFS["spit"]
    w = dict(base)
    w["timer"] = 0
    if wtype == "charge":
        w["active"] = False
        w["chargeTimer"] = 0
        w["chargeDx"] = 0
        w["chargeDy"] = 0
    return w


def make_player(pid, name, weapon_type):
    color = COLORS[pid % len(COLORS)]
    return {
        "id": pid,
        "name": name[:12] if name else f"player{pid}",
        "color": color,
        "x": WORLD_W / 2 + random.uniform(-200, 200),
        "y": WORLD_H / 2 + random.uniform(-200, 200),
        "hp": PLAYER_MAX_HP,
        "maxHp": PLAYER_MAX_HP,
        "radius": PLAYER_RADIUS,
        "speed": PLAYER_SPEED,
        "damageMulti": 1.0,
        "attackSpeedMulti": 1.0,
        "hpRegen": 0,
        "magnetRange": XP_MAGNET_RANGE,
        "xp": 0,
        "xpToLevel": 45,
        "level": 1,
        "weapons": [make_weapon(weapon_type)],
        "alive": True,
        "iframes": 2.0,  # spawn protection
        "facing": {"x": 1, "y": 0},
        "inputs": {"up": False, "down": False, "left": False, "right": False},
        "kills": 0,
        "score": 0,
    }


def init_game():
    return {
        "enemies": [],
        "projectiles": [],
        "gems": [],
        "time": 0,
        "wave": 1,
        "waveTimer": 0,
        "waveDuration": 20,
        "spawnTimer": 0,
        "spawnRate": 2.0,
        "kills": 0,
    }


def scale_enemy(base, wave):
    hp_scale = 1 + (wave - 1) * 0.12 + max(0, wave - 8) * 0.08
    speed_scale = 1 + (wave - 1) * 0.03
    dmg_scale = 1 + (wave - 1) * 0.1
    xp_scale = hp_scale * 0.9
    # scale with player count
    pc = max(1, len([p for p in players.values() if p["alive"]]))
    hp_scale *= 1 + (pc - 1) * 0.3  # +30% hp per extra player
    return {
        "name": base["name"],
        "hp": int(base["hp"] * hp_scale),
        "maxHp": int(base["hp"] * hp_scale),
        "speed": base["speed"] * speed_scale,
        "radius": base["radius"],
        "color": base["color"],
        "damage": int(base["damage"] * dmg_scale),
        "xp": int(base["xp"] * xp_scale),
        "x": 0, "y": 0,
        "hitFlash": 0,
        "orbitSign": 1 if random.random() < 0.5 else -1,
    }


def pick_enemy_type(wave):
    special = SPECIAL_WAVES.get(wave)
    if special and special["override"]:
        base = next(t for t in ENEMY_TYPES if t["name"] == special["override"])
        return scale_enemy(base, wave)

    pool = None
    for p in WAVE_POOLS:
        if wave <= p["maxWave"]:
            pool = p
            break
    if not pool:
        pool = WAVE_POOLS[-1]

    entries = list(pool["weights"].items())
    total = sum(w for _, w in entries)
    roll = random.random() * total
    for name, weight in entries:
        roll -= weight
        if roll <= 0:
            base = next(t for t in ENEMY_TYPES if t["name"] == name)
            return scale_enemy(base, wave)
    return scale_enemy(ENEMY_TYPES[0], wave)


def spawn_enemy(g):
    """spawn enemy near a random alive player"""
    alive = [p for p in players.values() if p["alive"]]
    if not alive:
        return
    target = random.choice(alive)
    angle = random.random() * math.pi * 2
    dist = 500 + random.random() * 200
    e = pick_enemy_type(g["wave"])
    e["x"] = max(e["radius"], min(WORLD_W - e["radius"], target["x"] + math.cos(angle) * dist))
    e["y"] = max(e["radius"], min(WORLD_H - e["radius"], target["y"] + math.sin(angle) * dist))
    g["enemies"].append(e)


def spawn_gem(g, x, y, xp):
    g["gems"].append({"x": x, "y": y, "xp": xp, "radius": XP_RADIUS})


def damage_enemy(g, e, dmg, killer_id=None):
    """apply damage to enemy, return True if killed"""
    e["hp"] -= dmg
    e["hitFlash"] = 1
    if e["hp"] <= 0:
        spawn_gem(g, e["x"], e["y"], e["xp"])
        if e in g["enemies"]:
            g["enemies"].remove(e)
        g["kills"] += 1
        if killer_id is not None:
            for p in players.values():
                if p["id"] == killer_id:
                    p["kills"] += 1
                    break
        return True
    return False


def fire_weapon(g, p, w):
    """fire a weapon for player p"""
    if w["type"] == "spit":
        nearest = None
        nearest_dist = w["range"]
        for e in g["enemies"]:
            dx = e["x"] - p["x"]
            dy = e["y"] - p["y"]
            d = math.sqrt(dx * dx + dy * dy)
            if d < nearest_dist:
                nearest = e
                nearest_dist = d
        if not nearest:
            return
        dx = nearest["x"] - p["x"]
        dy = nearest["y"] - p["y"]
        d = math.sqrt(dx * dx + dy * dy)
        if d < 1:
            return
        nx, ny = dx / d, dy / d
        for i in range(w.get("count", 1)):
            spread = (i - (w.get("count", 1) - 1) / 2) * 0.15 if w.get("count", 1) > 1 else 0
            cos_s = math.cos(spread)
            sin_s = math.sin(spread)
            fx = nx * cos_s - ny * sin_s
            fy = nx * sin_s + ny * cos_s
            g["projectiles"].append({
                "x": p["x"] + fx * 20,
                "y": p["y"] + fy * 20,
                "vx": fx * w["speed"],
                "vy": fy * w["speed"],
                "speed": w["speed"],
                "damage": w["damage"],
                "range": w["range"],
                "dist": 0,
                "pierce": w.get("pierce", 1),
                "radius": 5,
                "owner": p["id"],
            })
    elif w["type"] == "charge":
        fx = p["facing"]["x"]
        fy = p["facing"]["y"]
        d = math.sqrt(fx * fx + fy * fy)
        if d > 0:
            w["chargeDx"] = fx / d
            w["chargeDy"] = fy / d
        else:
            w["chargeDx"] = 1
            w["chargeDy"] = 0
        w["active"] = True
        w["chargeTimer"] = w["duration"]


def update(dt):
    """one server tick"""
    g = game
    if not g:
        return

    alive_players = [p for p in players.values() if p["alive"]]
    if not alive_players:
        return

    g["time"] += dt

    # --- wave progression ---
    g["waveTimer"] += dt
    if g["waveTimer"] >= g["waveDuration"]:
        g["wave"] += 1
        g["waveTimer"] = 0
        g["spawnRate"] = max(0.25, 2.0 * (0.88 ** (g["wave"] - 1)))

    # --- spawn enemies ---
    g["spawnTimer"] -= dt
    if g["spawnTimer"] <= 0:
        special = SPECIAL_WAVES.get(g["wave"])
        base_count = 1 + g["wave"] // 2
        pc = len(alive_players)
        base_count = int(base_count * (1 + (pc - 1) * 0.5))
        if special:
            base_count = math.ceil(base_count * special["countMulti"])
        count = min(base_count, 15)
        max_enemies = 80 + g["wave"] * 10 + pc * 20
        to_spawn = min(count, max_enemies - len(g["enemies"]))
        for _ in range(max(0, to_spawn)):
            spawn_enemy(g)
        g["spawnTimer"] = g["spawnRate"]

    # --- update each player ---
    for p in players.values():
        if not p["alive"]:
            continue

        # movement
        inp = p["inputs"]
        dx = (1 if inp.get("right") else 0) - (1 if inp.get("left") else 0)
        dy = (1 if inp.get("down") else 0) - (1 if inp.get("up") else 0)
        if dx and dy:
            dx *= 0.7071
            dy *= 0.7071
        if dx or dy:
            p["facing"] = {"x": dx, "y": dy}
        p["x"] += dx * p["speed"] * dt
        p["y"] += dy * p["speed"] * dt
        p["x"] = max(p["radius"], min(WORLD_W - p["radius"], p["x"]))
        p["y"] = max(p["radius"], min(WORLD_H - p["radius"], p["y"]))

        # hp regen
        if p["hpRegen"] > 0:
            p["hp"] = min(p["maxHp"], p["hp"] + p["hpRegen"] * dt)

        # iframes
        if p["iframes"] > 0:
            p["iframes"] -= dt

        # weapons
        for w in p["weapons"]:
            w["timer"] -= dt * p["attackSpeedMulti"]
            if w["timer"] <= 0 and w["type"] not in ("breath", "orbit"):
                w["timer"] = w["cooldown"]
                fire_weapon(g, p, w)

            # charge active timer
            if w["type"] == "charge" and w.get("active"):
                w["chargeTimer"] -= dt
                if w["chargeTimer"] <= 0:
                    w["active"] = False

            # orbit blade damage
            if w["type"] == "orbit":
                w["phase"] = w.get("phase", 0) + w.get("rotSpeed", 3) * dt
                for b in range(w.get("bladeCount", 2)):
                    angle = w["phase"] + (b * math.pi * 2 / w.get("bladeCount", 2))
                    bx = p["x"] + math.cos(angle) * w.get("radius", 70)
                    by = p["y"] + math.sin(angle) * w.get("radius", 70)
                    for e in list(g["enemies"]):
                        ddx = bx - e["x"]
                        ddy = by - e["y"]
                        if ddx * ddx + ddy * ddy < (10 + e["radius"]) ** 2:
                            damage_enemy(g, e, w.get("damage", 12) * p["damageMulti"] * dt * 8, p["id"])

        # breath aura damage
        for w in p["weapons"]:
            if w["type"] == "breath":
                for e in list(g["enemies"]):
                    edx = p["x"] - e["x"]
                    edy = p["y"] - e["y"]
                    dist = math.sqrt(edx * edx + edy * edy)
                    if dist < w.get("radius", 80) + e["radius"]:
                        damage_enemy(g, e, w["damage"] * p["damageMulti"] * dt, p["id"])

        # charge sweep damage
        for w in p["weapons"]:
            if w["type"] == "charge" and w.get("active"):
                cdx = w["chargeDx"]
                cdy = w["chargeDy"]
                for e in list(g["enemies"]):
                    ex = e["x"] - p["x"]
                    ey = e["y"] - p["y"]
                    forward = ex * cdx + ey * cdy
                    lateral = abs(ex * (-cdy) + ey * cdx)
                    if forward > -w["width"] and forward < w["speed"] * w["duration"] and lateral < w["width"] + e["radius"]:
                        damage_enemy(g, e, w["damage"] * p["damageMulti"] * dt * 3, p["id"])

    # --- update projectiles ---
    for proj in list(g["projectiles"]):
        proj["x"] += proj["vx"] * dt
        proj["y"] += proj["vy"] * dt
        proj["dist"] += proj["speed"] * dt

        if proj["dist"] > proj["range"]:
            if proj in g["projectiles"]:
                g["projectiles"].remove(proj)
            continue

        for e in list(g["enemies"]):
            edx = proj["x"] - e["x"]
            edy = proj["y"] - e["y"]
            if edx * edx + edy * edy < (proj["radius"] + e["radius"]) ** 2:
                dmg_multi = 1.0
                for p in players.values():
                    if p["id"] == proj.get("owner"):
                        dmg_multi = p["damageMulti"]
                        break
                damage_enemy(g, e, proj["damage"] * dmg_multi, proj.get("owner"))
                proj["pierce"] -= 1
                if proj["pierce"] <= 0:
                    if proj in g["projectiles"]:
                        g["projectiles"].remove(proj)
                    break

    # --- update enemies ---
    for e in list(g["enemies"]):
        if e["hitFlash"] > 0:
            e["hitFlash"] -= dt * 5

        # find nearest alive player
        nearest_p = None
        nearest_dist = float("inf")
        for p in players.values():
            if not p["alive"]:
                continue
            ddx = p["x"] - e["x"]
            ddy = p["y"] - e["y"]
            d = math.sqrt(ddx * ddx + ddy * ddy)
            if d < nearest_dist:
                nearest_p = p
                nearest_dist = d

        if not nearest_p:
            continue

        ddx = nearest_p["x"] - e["x"]
        ddy = nearest_p["y"] - e["y"]
        dist = math.sqrt(ddx * ddx + ddy * ddy)
        if dist > 1:
            if e["name"] == "ghost":
                nx = ddx / dist
                ny = ddy / dist
                sign = e.get("orbitSign", 1)
                perp_x = -ny * sign
                perp_y = nx * sign
                inward = 0.8 if dist > 100 else 1.0
                orbit = 0.6 if dist > 100 else (0.3 if dist > 30 else 0.1)
                mx = nx * inward + perp_x * orbit
                my = ny * inward + perp_y * orbit
                ml = math.sqrt(mx * mx + my * my)
                if ml > 0:
                    e["x"] += (mx / ml) * e["speed"] * dt
                    e["y"] += (my / ml) * e["speed"] * dt
            else:
                e["x"] += (ddx / dist) * e["speed"] * dt
                e["y"] += (ddy / dist) * e["speed"] * dt

        e["x"] = max(e["radius"], min(WORLD_W - e["radius"], e["x"]))
        e["y"] = max(e["radius"], min(WORLD_H - e["radius"], e["y"]))

        # damage players on contact
        for p in players.values():
            if not p["alive"] or p["iframes"] > 0:
                continue
            pdx = p["x"] - e["x"]
            pdy = p["y"] - e["y"]
            pdist = math.sqrt(pdx * pdx + pdy * pdy)
            if pdist < p["radius"] + e["radius"]:
                p["hp"] -= e["damage"]
                p["iframes"] = 0.5
                if p["hp"] <= 0:
                    p["hp"] = 0
                    p["alive"] = False

    # --- gem pickup ---
    for gem in list(g["gems"]):
        for p in players.values():
            if not p["alive"]:
                continue
            gdx = p["x"] - gem["x"]
            gdy = p["y"] - gem["y"]
            dist = math.sqrt(gdx * gdx + gdy * gdy)

            if dist < p["magnetRange"] and dist > 0:
                pull = XP_MAGNET_SPEED * dt
                gem["x"] += (gdx / dist) * min(pull, dist)
                gem["y"] += (gdy / dist) * min(pull, dist)

            if dist < p["radius"] + gem["radius"]:
                p["xp"] += gem["xp"]
                p["score"] += gem["xp"]
                if gem in g["gems"]:
                    g["gems"].remove(gem)
                while p["xp"] >= p["xpToLevel"]:
                    p["xp"] -= p["xpToLevel"]
                    p["level"] += 1
                    p["xpToLevel"] = int(p["xpToLevel"] * 1.45)
                break


def game_state_for(viewer_id):
    """build state snapshot for a specific player"""
    g = game
    ps = []
    for p in players.values():
        ps.append({
            "id": p["id"],
            "name": p["name"],
            "color": p["color"],
            "x": round(p["x"], 1),
            "y": round(p["y"], 1),
            "hp": round(p["hp"], 1),
            "maxHp": p["maxHp"],
            "alive": p["alive"],
            "level": p["level"],
            "kills": p["kills"],
            "weapons": [w["type"] for w in p["weapons"]],
        })

    enemies = [{
        "name": e["name"],
        "x": round(e["x"], 1),
        "y": round(e["y"], 1),
        "hp": e["hp"],
        "maxHp": e["maxHp"],
        "radius": e["radius"],
        "color": e["color"],
        "hitFlash": round(e["hitFlash"], 2),
    } for e in g["enemies"]]

    gems = [{"x": round(gem["x"], 1), "y": round(gem["y"], 1), "xp": gem["xp"]} for gem in g["gems"]]

    projs = [{
        "x": round(proj["x"], 1),
        "y": round(proj["y"], 1),
        "radius": proj["radius"],
        "owner": proj.get("owner"),
    } for proj in g["projectiles"]]

    return {
        "type": "state",
        "t": time.time(),
        "wave": g["wave"],
        "time": round(g["time"], 1),
        "kills": g["kills"],
        "players": ps,
        "enemies": enemies,
        "gems": gems,
        "projectiles": projs,
        "you": viewer_id,
        "arena": {"w": WORLD_W, "h": WORLD_H},
    }


async def broadcast():
    if not players:
        return
    gone = []
    for ws, p in list(players.items()):
        try:
            msg = json.dumps(game_state_for(p["id"]))
            await ws.send(msg)
        except websockets.exceptions.ConnectionClosed:
            gone.append(ws)
    for ws in gone:
        if ws in players:
            print(f"[-] {players[ws]['name']} disconnected ({len(players) - 1} players)")
            del players[ws]


async def game_loop():
    global game
    game = init_game()
    while True:
        update(TICK_DT)
        await broadcast()
        await asyncio.sleep(TICK_DT)


async def handler(ws):
    global next_id

    pid = next_id
    next_id += 1
    p = None

    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if msg.get("type") == "join":
                name = str(msg.get("name", ""))[:12].strip() or f"player{pid}"
                weapon = msg.get("weapon", "spit")
                if weapon not in WEAPON_DEFS:
                    weapon = "spit"
                p = make_player(pid, name, weapon)
                players[ws] = p
                print(f"[+] {name} joined with {weapon} ({len(players)} players)")

                await ws.send(json.dumps({
                    "type": "welcome",
                    "you": pid,
                    "name": p["name"],
                    "color": p["color"],
                    "arena": {"w": WORLD_W, "h": WORLD_H},
                }))
                continue

            if not p:
                continue

            if msg.get("type") == "input":
                keys = msg.get("keys", {})
                p["inputs"]["up"] = bool(keys.get("up"))
                p["inputs"]["down"] = bool(keys.get("down"))
                p["inputs"]["left"] = bool(keys.get("left"))
                p["inputs"]["right"] = bool(keys.get("right"))

            elif msg.get("type") == "name":
                new_name = str(msg.get("name", ""))[:12].strip()
                if new_name:
                    p["name"] = new_name

            elif msg.get("type") == "respawn":
                weapon = msg.get("weapon", "spit")
                if weapon not in WEAPON_DEFS:
                    weapon = "spit"
                p["x"] = WORLD_W / 2 + random.uniform(-200, 200)
                p["y"] = WORLD_H / 2 + random.uniform(-200, 200)
                p["hp"] = PLAYER_MAX_HP
                p["maxHp"] = PLAYER_MAX_HP
                p["speed"] = PLAYER_SPEED
                p["damageMulti"] = 1.0
                p["attackSpeedMulti"] = 1.0
                p["hpRegen"] = 0
                p["magnetRange"] = XP_MAGNET_RANGE
                p["xp"] = 0
                p["xpToLevel"] = 45
                p["level"] = 1
                p["weapons"] = [make_weapon(weapon)]
                p["alive"] = True
                p["iframes"] = 2.0
                p["kills"] = 0

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if ws in players:
            print(f"[-] {p['name'] if p else '?'} left ({len(players) - 1} players)")
            del players[ws]


async def main():
    print(f"survivors v1b server on :{PORT}")
    print(f"world: {WORLD_W}x{WORLD_H}, tick: {TICK_RATE}Hz, max players: {MAX_PLAYERS}")
    async with websockets.serve(handler, "0.0.0.0", PORT):
        await game_loop()


if __name__ == "__main__":
    asyncio.run(main())
