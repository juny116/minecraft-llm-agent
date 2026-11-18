"""Game client."""

from __future__ import annotations

import json
import socket
import time


class GameClient:
    def __init__(self, host: str, port: int):
        self.host, self.port = host, port
        self._connect()

    def _connect(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=5)
        self.f = self.sock.makefile("rw", encoding="utf-8", newline="\n")
        print(f"[bot] connected {self.host}:{self.port}")

    def reconnect(self, retry_delay: float = 5.0):
        """Block until reconnected — survives client restarts during infinite runs."""
        self.close()
        while True:
            try:
                self._connect()
                self.enable()
                return
            except OSError as e:
                print(f"[bot] 재접속 대기({e}) — {retry_delay:.0f}s 후 재시도")
                time.sleep(retry_delay)

    def send(self, obj: dict) -> dict:
        self.f.write(json.dumps(obj) + "\n")
        self.f.flush()
        line = self.f.readline()
        if not line:
            raise ConnectionError("bot connection closed")
        return json.loads(line)

    def state(self) -> dict:
        return self.send({"type": "state"})

    def connect_world(self, host: str, port: int) -> dict:
        """Tell the (menu-screen) client to join an MC server."""
        return self.send({"type": "connect", "host": host, "port": port})

    def ensure_in_game(
        self, host: str, port: int, poll: float = 3.0, resend_after: float = 25.0
    ) -> None:
        """Block until the bot is in a world. If it isn't (fresh boot, kicked,
        disconnected), dial the server and keep retrying — survives client/server
        restarts during infinite runs. Re-sends connect if a join stalls."""
        last_send = 0.0
        while True:
            try:
                st = self.state()
            except (ConnectionError, OSError) as e:
                print(f"[bot] control 끊김({e}) — 재접속")
                self.reconnect()
                continue
            if st.get("ready"):
                return
            now = time.monotonic()
            if now - last_send >= resend_after:
                print(f"[bot] 월드 밖 -> connect {host}:{port}")
                try:
                    self.connect_world(host, port)
                except (ConnectionError, OSError):
                    self.reconnect()
                    continue
                last_send = now
            time.sleep(poll)

    def enable(self):
        return self.send({"type": "enable", "on": True})

    def disable(self):
        try:
            self.send({"type": "disable"})
        except Exception:
            pass

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass
