"""Planner."""

from __future__ import annotations

import json
import queue
import threading

from .action_tools import SET_LESSONS_TOOL, UPDATE_MEMORY_TOOL
from .file_memory import FileMemory
from .model_client import ChatCompletionClient
from .prompts import PLANNER_SYSTEM


def progress_summary(s: dict) -> str:
    """Compact 'what the bot already has / what tier it's reached' line for the Planner,
    which otherwise reflects only on journal+goals and keeps regressing to early goals."""
    inv: dict[str, int] = {}
    for it in s.get("inventory", []):
        n = (it.get("item", "") or "").split(":")[-1]
        if n:
            inv[n] = inv.get(n, 0) + it.get("count", 0)
    has = lambda *names: any(inv.get(n, 0) > 0 for n in names)
    flags = [
        f"나무도구={'O' if has('wooden_pickaxe') else 'X'}",
        f"돌도구={'O' if has('stone_pickaxe', 'stone_axe') else 'X'}",
        f"화로={'O' if has('furnace') else 'X'}",
        f"상자={'O' if has('chest') else 'X'}",
        f"철광석/철={'O' if has('raw_iron', 'iron_ingot') else 'X'}",
        f"철도구={'O' if has('iron_pickaxe') else 'X'}",
    ]
    top = sorted(inv.items(), key=lambda kv: -kv[1])[:8]
    p = s.get("pos", {})
    return (
        "보유 진행단계: "
        + ", ".join(flags)
        + f" | 현재 높이 y={p.get('y', 0):.0f}(철은 y50↓ 깊은 곳) | 주요 보유: "
        + ", ".join(f"{k}x{v}" for k, v in top if k)
    )


class Planner:
    def __init__(self, llm: ChatCompletionClient, mem: FileMemory):
        self.llm = llm
        self.mem = mem
        self.q: queue.Queue = queue.Queue(maxsize=1)  # coalesce: at most 1 pending
        self.thread = threading.Thread(target=self._run, name="planner", daemon=True)
        self.thread.start()

    def request(self, reason: str, progress: str = ""):
        """Non-blocking. If a reflection is already pending/running, coalesce."""
        job = {
            "reason": reason,
            "journal": self.mem.journal_tail(14),
            "goals": self.mem.load_goals(),
            "progress": progress,
        }
        try:
            self.q.put_nowait(job)
            print(f"[planner] 반성 요청 큐잉: {reason}")
        except queue.Full:
            print(f"[planner] 이미 반성 대기중 — 합침('{reason}' 생략)")

    def _run(self):
        while True:
            job = self.q.get()
            try:
                self._reflect(job)
            except Exception as e:
                print(f"[planner] 반성 중 오류: {e}")

    def _reflect(self, job: dict):
        user = (
            f"반성 트리거: {job['reason']}\n"
            f"★ 내 현재 진행/보유(이게 사실이다): {job.get('progress') or '(미상)'}\n"
            f"현재 목표: {json.dumps(job['goals'], ensure_ascii=False)}\n"
            f"최근 일지:\n{job['journal'] or '(없음)'}\n"
            f"지금까지의 교훈:\n{self.mem.read_lessons(limit=40) or '(없음)'}\n\n"
            "위를 차분히 돌아보고 update_memory 도구로 교훈과 갱신된 목표를 내. "
            "★중요: '내 현재 진행/보유'를 보고 이미 가진 단계는 절대 다시 목표로 삼지 마. "
            "돌도구·화로가 이미 있으면 목표는 '철광석 캐기→철도구', 철까지 있으면 '집 완성·농장·탐험'처럼 "
            "반드시 '다음 단계'로 전진시켜. 양모/침대/나무도구 같은 초반 목표로 되돌아가지 마."
        )
        msg = self.llm.chat(
            [
                {"role": "system", "content": PLANNER_SYSTEM},
                {"role": "user", "content": user},
            ],
            tools=[UPDATE_MEMORY_TOOL],
            enable_thinking=True,
        )
        applied = False
        for tc in msg.get("tool_calls") or []:
            if tc["function"]["name"] == "update_memory":
                try:
                    args = json.loads(tc["function"].get("arguments") or "{}")
                except json.JSONDecodeError:
                    continue
                self.mem.apply_plan(args)
                applied = True
                print(
                    f"[planner] 메모리 갱신: {json.dumps(args, ensure_ascii=False)[:200]}"
                )
        if not applied:  # fallback: keep the thinking as a lesson
            txt = (msg.get("content") or "").strip()
            if txt:
                self.mem.append_lesson("(반성) " + txt[:200])
            print("[planner] 도구 미사용 — 텍스트를 교훈으로 저장")
        # Bloated lesson list? consolidate it (dedup + merge) so recall stays dense.
        if len(self.mem.read_lessons_lines()) > 30:
            try:
                self._consolidate()
            except Exception as e:
                print(f"[planner] 교훈 통합 오류: {e}")

    def _consolidate(self):
        lines = self.mem.read_lessons_lines()
        user = (
            "아래는 whoami_rwl이 쌓아온 교훈 목록인데 중복·유사한 게 너무 많아. "
            "비슷하거나 같은 뜻인 건 하나로 합치고, 너무 일반적이거나 쓸모없는 건 빼줘. "
            "단 서로 다른(겹치지 않는) 교훈은 개수 상관없이 다 남겨 — 억지로 개수를 줄이거나 맞추지 마. "
            "각 교훈은 구체적이고 행동에 바로 쓸모있게.\n\n"
            "교훈들:\n" + "\n".join(lines)
        )
        msg = self.llm.chat(
            [
                {"role": "system", "content": PLANNER_SYSTEM},
                {"role": "user", "content": user},
            ],
            tools=[SET_LESSONS_TOOL],
            enable_thinking=True,
        )
        for tc in msg.get("tool_calls") or []:
            if tc["function"]["name"] == "set_lessons":
                try:
                    new = (json.loads(tc["function"].get("arguments") or "{}")).get(
                        "lessons"
                    ) or []
                except json.JSONDecodeError:
                    return
                if 5 <= len(new) <= 40:
                    self.mem.write_lessons(new)
                    print(f"[planner] 교훈 통합: {len(lines)}개 → {len(new)}개")
                return
