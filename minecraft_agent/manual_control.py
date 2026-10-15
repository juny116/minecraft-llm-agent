#!/usr/bin/env python3
"""
Interactive test controller for the mcagent mod.

Run this on the SAME machine as the Minecraft client (the mod binds to
127.0.0.1). Connect, then type short commands:

    enable            turn bot control on (required before movement)
    disable           hand control back to the keyboard
    fwd / back        walk forward / backward (hold)
    left / right      strafe (hold)
    stop              stop all movement
    sprint / walk     toggle sprint on/off
    sneak / unsneak   toggle sneak
    jump              hop once
    look <yaw> <pitch>   face an absolute direction (yaw: -180..180, pitch: -90..90)
    turn <dyaw> <dpitch> turn by a relative amount
    slot <0-8>        select hotbar slot
    attack            left click (mine one hit / hit entity)
    use               right click (place / interact / use item)
    mine on|off       hold left click (continuous mining)
    goto <x> <y> <z>  Baritone: pathfind to a block (needs Baritone installed)
    goto <x> <z>      Baritone: pathfind to an X/Z column
    near <x> <y> <z> [r]  Baritone: pathfind to within r blocks (default 2)
    follow [id]       Baritone: follow entity id, or all players if omitted
    cancel            stop Baritone pathing / following
    state             print the current world/player snapshot
    raw {json}        send a raw JSON command
    quit
"""

import json
import socket

HOST = "127.0.0.1"
PORT = 25599


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    host, port = args.host, args.port
    sock = socket.create_connection((host, port), timeout=5)
    f = sock.makefile("rw", encoding="utf-8", newline="\n")
    print(f"connected to {host}:{port}. type 'help' for commands.")

    def send(obj):
        f.write(json.dumps(obj) + "\n")
        f.flush()
        return f.readline().rstrip("\n")

    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not line:
            continue
        parts = line.split()
        cmd = parts[0].lower()
        args = parts[1:]

        try:
            if cmd in ("quit", "exit", "q"):
                break
            elif cmd == "help":
                print(__doc__)
                continue
            elif cmd == "enable":
                resp = send({"type": "enable", "on": True})
            elif cmd == "disable":
                resp = send({"type": "disable"})
            elif cmd == "fwd":
                resp = send({"type": "move", "forward": 1, "strafe": 0})
            elif cmd == "back":
                resp = send({"type": "move", "forward": -1, "strafe": 0})
            elif cmd == "left":
                resp = send({"type": "move", "forward": 0, "strafe": 1})
            elif cmd == "right":
                resp = send({"type": "move", "forward": 0, "strafe": -1})
            elif cmd == "stop":
                resp = send({"type": "stop"})
            elif cmd == "sprint":
                resp = send({"type": "sprint", "on": True})
            elif cmd == "walk":
                resp = send({"type": "sprint", "on": False})
            elif cmd == "sneak":
                resp = send({"type": "sneak", "on": True})
            elif cmd == "unsneak":
                resp = send({"type": "sneak", "on": False})
            elif cmd == "jump":
                resp = send({"type": "jump"})
            elif cmd == "look":
                resp = send(
                    {"type": "look", "yaw": float(args[0]), "pitch": float(args[1])}
                )
            elif cmd == "turn":
                resp = send(
                    {"type": "look", "dyaw": float(args[0]), "dpitch": float(args[1])}
                )
            elif cmd == "slot":
                resp = send({"type": "select_slot", "slot": int(args[0])})
            elif cmd == "attack":
                resp = send({"type": "attack"})
            elif cmd == "use":
                resp = send({"type": "use"})
            elif cmd == "mine":
                resp = send({"type": "mine", "on": args[0].lower() == "on"})
            elif cmd == "goto":
                if len(args) >= 3:
                    resp = send(
                        {
                            "type": "goto",
                            "x": int(args[0]),
                            "y": int(args[1]),
                            "z": int(args[2]),
                        }
                    )
                else:
                    resp = send({"type": "goto", "x": int(args[0]), "z": int(args[1])})
            elif cmd == "near":
                msg = {
                    "type": "goto_near",
                    "x": int(args[0]),
                    "y": int(args[1]),
                    "z": int(args[2]),
                }
                if len(args) >= 4:
                    msg["range"] = int(args[3])
                resp = send(msg)
            elif cmd == "follow":
                if args:
                    resp = send({"type": "follow", "entityId": int(args[0])})
                else:
                    resp = send({"type": "follow"})
            elif cmd == "cancel":
                resp = send({"type": "cancel"})
            elif cmd == "state":
                resp = send({"type": "state"})
                print(json.dumps(json.loads(resp), indent=2, ensure_ascii=False))
                continue
            elif cmd == "raw":
                resp = send(json.loads(line[4:]))
            else:
                print("unknown command; type 'help'")
                continue
            print(resp)
        except IndexError:
            print("missing argument; type 'help'")
        except Exception as e:
            print("error:", e)

    sock.close()


if __name__ == "__main__":
    main()
