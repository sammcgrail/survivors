#!/usr/bin/env python3.11
"""barn arena — multiplayer game server. websocket on port 7700."""

import asyncio
import json
import time
import math
import random
import websockets

# --- config ---
PORT = 7700
TICK_RATE = 20          # server ticks per second
TICK_DT = 1.0 / TICK_RATE
ARENA_W = 800
ARENA_H = 600
PLAYER_SPEED = 200      # px/sec
PLAYER_RADIUS = 12

COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#f1c40f",
    "#9b59b6", "#e67e22", "#1abc9c", "#e84393",
    "#00cec9", "#fd79a8", "#6c5ce7", "#ffeaa7",
]

NAMES = [
    "barn", "nob", "grob", "peb", "wonk", "dind",
    "fokk", "snek", "greb", "bork", "pleb", "bonk",
]

# --- state ---
players = {}        # ws -> player dict
next_color = 0
next_name = 0

def make_player(ws):
    global next_color, next_name
    pid = id(ws)
    color = COLORS[next_color % len(COLORS)]
    name = NAMES[next_name % len(NAMES)]
    next_color += 1
    next_name += 1
    return {
        "id": pid,
        "name": name,
        "color": color,
        "x": random.uniform(100, ARENA_W - 100),
        "y": random.uniform(100, ARENA_H - 100),
        "vx": 0, "vy": 0,
        "hp": 100,
        "alive": True,
        "inputs": {"up": False, "down": False, "left": False, "right": False},
    }

def game_state():
    """snapshot for broadcast"""
    return {
        "type": "state",
        "t": time.time(),
        "arena": {"w": ARENA_W, "h": ARENA_H},
        "players": [
            {
                "id": p["id"],
                "name": p["name"],
                "color": p["color"],
                "x": round(p["x"], 1),
                "y": round(p["y"], 1),
                "hp": p["hp"],
                "alive": p["alive"],
            }
            for p in players.values()
        ],
    }

def update():
    """one game tick"""
    for p in players.values():
        if not p["alive"]:
            continue
        inp = p["inputs"]
        dx = (1 if inp["right"] else 0) - (1 if inp["left"] else 0)
        dy = (1 if inp["down"] else 0) - (1 if inp["up"] else 0)
        # normalize diagonal
        if dx and dy:
            dx *= 0.7071
            dy *= 0.7071
        p["x"] += dx * PLAYER_SPEED * TICK_DT
        p["y"] += dy * PLAYER_SPEED * TICK_DT
        # clamp to arena
        r = PLAYER_RADIUS
        p["x"] = max(r, min(ARENA_W - r, p["x"]))
        p["y"] = max(r, min(ARENA_H - r, p["y"]))

async def broadcast():
    """send state to all connected clients"""
    if not players:
        return
    msg = json.dumps(game_state())
    gone = []
    for ws in players:
        try:
            await ws.send(msg)
        except websockets.exceptions.ConnectionClosed:
            gone.append(ws)
    for ws in gone:
        del players[ws]

async def game_loop():
    """fixed timestep game loop"""
    while True:
        update()
        await broadcast()
        await asyncio.sleep(TICK_DT)

async def handler(ws):
    """handle one client connection"""
    p = make_player(ws)
    players[ws] = p
    print(f"[+] {p['name']} joined ({len(players)} players)")

    # send welcome
    await ws.send(json.dumps({
        "type": "welcome",
        "you": p["id"],
        "name": p["name"],
        "color": p["color"],
        "arena": {"w": ARENA_W, "h": ARENA_H},
    }))

    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
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

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if ws in players:
            print(f"[-] {p['name']} left ({len(players)-1} players)")
            del players[ws]

async def main():
    print(f"barn arena server on :{PORT}")
    async with websockets.serve(handler, "0.0.0.0", PORT):
        await game_loop()

if __name__ == "__main__":
    asyncio.run(main())
