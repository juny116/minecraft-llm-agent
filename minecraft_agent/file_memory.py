"""File memory."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path


def _atomic_write(path: Path, text: str):
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class FileMemory:
    def __init__(self, d: Path):
        self.dir = d
        self.dir.mkdir(parents=True, exist_ok=True)
        self.goals = self.dir / "goals.json"
        self.lessons = self.dir / "lessons.md"
        self.journal = self.dir / "journal.md"
        self.places_file = self.dir / "places.json"
        self._places_lock = threading.Lock()
        self._lessons_lock = threading.Lock()  # Planner + Responder both append lessons
        self.places: dict[str, str] = {}
        if self.places_file.exists():
            try:
                self.places = json.loads(self.places_file.read_text(encoding="utf-8"))
            except Exception:
                self.places = {}
        if not self.goals.exists():
            self.write_goals(
                {
                    "long_term": ["마을에서 느긋하게 자급자족하며 산다"],
                    "short_term": ["주변을 둘러보고 뭐가 있는지 파악한다"],
                    "mood": "느긋",
                }
            )

    # ---- Planner-owned writers ----
    def write_goals(self, goals: dict):
        _atomic_write(self.goals, json.dumps(goals, ensure_ascii=False, indent=2))

    def append_lesson(self, text: str):
        text = text.strip().replace("\n", " ")
        if not text:
            return
        with self._lessons_lock:
            existing = self.read_lessons_lines()
            existing.append("- " + text)
            existing = existing[-200:]  # keep storage bounded
            _atomic_write(self.lessons, "\n".join(existing) + "\n")

    def write_lessons(self, lines):
        """Replace the whole lesson list (used by Planner consolidation)."""
        out = ["- " + l.lstrip("-").strip() for l in lines if l and l.strip()][:60]
        with self._lessons_lock:
            _atomic_write(self.lessons, "\n".join(out) + "\n")

    def apply_plan(self, args: dict):
        for lesson in (args.get("lessons") or [])[:5]:
            self.append_lesson(lesson)
        g = self.load_goals()
        if args.get("long_term"):
            g["long_term"] = args["long_term"]
        if args.get("short_term"):
            g["short_term"] = args["short_term"]
        if args.get("mood"):
            g["mood"] = args["mood"]
        self.write_goals(g)

    # ---- Actor-owned writers ----
    def record_event(self, text: str):
        with self.journal.open("a", encoding="utf-8") as fh:
            fh.write(text.rstrip() + "\n")

    def remember_places(self, notable):
        with self._places_lock:
            for _, name, x, y, z in notable:
                self.places[f"{x},{y},{z}"] = name
            if len(self.places) > 400:
                self.places = dict(list(self.places.items())[-400:])
            snapshot = dict(self.places)
        _atomic_write(self.places_file, json.dumps(snapshot, ensure_ascii=False))

    # ---- readers ----
    def load_goals(self) -> dict:
        try:
            return json.loads(self.goals.read_text(encoding="utf-8"))
        except Exception:
            return {"long_term": [], "short_term": [], "mood": ""}

    def read_lessons_lines(self) -> list:
        if not self.lessons.exists():
            return []
        return [
            ln
            for ln in self.lessons.read_text(encoding="utf-8").splitlines()
            if ln.strip()
        ]

    def read_lessons(self, limit: int = 60) -> str:
        return "\n".join(self.read_lessons_lines()[-limit:])

    def journal_tail(self, n: int = 12) -> str:
        if not self.journal.exists():
            return ""
        return "\n".join(self.journal.read_text(encoding="utf-8").splitlines()[-n:])

    def places_near(self, pos: dict, limit: int = 12) -> str:
        with self._places_lock:
            items = list(self.places.items())
        if not items:
            return ""
        px, py, pz = pos.get("x", 0), pos.get("y", 0), pos.get("z", 0)
        scored = []
        for key, name in items:
            try:
                x, y, z = (int(v) for v in key.split(","))
            except ValueError:
                continue
            scored.append(
                ((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2, name, x, y, z)
            )
        scored.sort()
        return ", ".join(f"{n}({x},{y},{z})" for _, n, x, y, z in scored[:limit])

    def recall(self, state: dict) -> str:
        """The memory context injected into every Actor decision (rule-based;
        the *content* is what the ChatCompletionClient itself wrote)."""
        g = self.load_goals()
        parts = [
            f"[장기목표] {'; '.join(g.get('long_term', []))}",
            f"[단기목표] {'; '.join(g.get('short_term', []))}",
            f"[기분] {g.get('mood', '')}",
        ]
        lessons = self.read_lessons(limit=60)
        if lessons:
            parts.append("[배운 교훈]\n" + lessons)
        seen = self.places_near(state.get("pos", {}))
        if seen:
            parts.append(f"[가본 곳(가까운순)] {seen}")
        tail = self.journal_tail(8)
        if tail:
            parts.append("[최근 일지]\n" + tail)
        return "\n".join(parts)
