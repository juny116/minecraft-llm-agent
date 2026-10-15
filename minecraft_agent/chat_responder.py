"""Chat responder."""

from __future__ import annotations

import json
import re
import socket
import threading
import time

from .action_tools import RESPOND_TOOL
from .model_client import ChatCompletionClient
from .observations import new_user_chats
from .prompts import PERSONA


class Responder:
    """Parallel chat responder. Runs on its OWN socket alongside the Actor loop, so
    whoami_rwl can reply WHILE walking/mining — the Actor never stops to talk. Polls
    in-game chat; when a line is addressed to the bot, the 27B model (thinking ON —
    chat isn't time-critical, so it reasons deeply) drafts an in-character reply AND
    decides itself whether the exchange is worth saving as a lesson, then sends the
    reply through this thread's own connection. The Actor still SEES chat (to act on
    requests like "이리 와"), but no longer speaks."""

    def __init__(self, llm: ChatCompletionClient, mem, host: str, port: int):
        self.llm = llm  # 27B planner-tier model (chat isn't time-critical)
        self.mem = mem  # to record player teachings as lessons directly
        self.host, self.port = host, port
        self.marker = None
        self.f = None
        self.thread = threading.Thread(target=self._run, name="responder", daemon=True)
        self.thread.start()

    def _connect(self):
        sock = socket.create_connection((self.host, self.port), timeout=5)
        self.f = sock.makefile("rw", encoding="utf-8", newline="\n")

    def _send(self, obj: dict) -> dict:
        self.f.write(json.dumps(obj) + "\n")
        self.f.flush()
        line = self.f.readline()
        if not line:
            raise ConnectionError("responder connection closed")
        return json.loads(line)

    def _run(self):
        while True:
            try:
                if self.f is None:
                    self._connect()
                    print("[responder] 채팅 응답 스레드 연결됨(병렬, 별도 소켓)")
                state = self._send({"type": "state"})
                if state.get("ready"):
                    # 새 '플레이어' 메시지가 떴을 때만 발동(자기 말/시스템엔 반응 안 함).
                    new_player, self.marker = new_user_chats(
                        state, self.marker, state.get("name", "")
                    )
                    if new_player:
                        # 단, 판단은 새 줄만 보지 말고 '최근 대화 전체 맥락'으로 — 안 그러면
                        # "이해했어?" 같은 후속 줄을 따로 보고 누구한테 하는 말인지 못 알아챈다.
                        convo = self._recent_convo(state)
                        self._maybe_reply(convo, new_player, state)
            except (ConnectionError, OSError) as e:
                print(f"[responder] 연결 끊김({e}) — 5s 후 재연결")
                self.f = None
                time.sleep(5.0)
                continue
            except Exception as e:
                print(f"[responder] 오류: {e}")
            time.sleep(3.0)

    def _recent_convo(self, state: dict, n: int = 16) -> str:
        """최근 채팅 대화창 — 플레이어들 말 + 자기(whoami_rwl) 말까지 포함(맥락 유지용).
        시스템/퀘스트 broadcast(<...> 없는 줄)는 제외."""
        raw = state.get("recentChat") or []
        out = []
        for m in raw[-n:]:
            clean = re.sub("§.", "", m).strip()
            if "<" in clean and ">" in clean:
                out.append(clean)
        return "\n".join(out)

    def _self_status(self, state: dict) -> str:
        """채팅 답변을 '실제 내 상황'에 근거하게 만드는 짧은 요약 — Actor가 지금 뭘 하는지.
        이게 없으면 봇이 행동과 무관하게 그럴듯한 말만 지어낸다."""
        p = state.get("pos", {})
        inv = [
            f"{it['item'].split(':')[-1]}x{it['count']}"
            for it in state.get("inventory", [])
            if it.get("item")
        ]
        bar = state.get("baritone", {})
        doing = []
        if bar.get("goal"):
            doing.append(f"어딘가로 이동중(목표 {bar.get('goal')})")
        if state.get("mineTarget"):
            doing.append("블록 캐는 중")
        t, night = state.get("timeOfDay", 0), state.get("isNight")
        return (
            f"hp={state.get('health')}/{state.get('maxHealth')} "
            f"{'🌙밤(몹위험)' if night else '낮'}(t={t}/24000) "
            f"내위치=({p.get('x', 0):.0f},{p.get('y', 0):.0f},{p.get('z', 0):.0f}) "
            f"인벤={', '.join(inv) or '빈손'} "
            f"지금하는일={' + '.join(doing) or '특별히 없음(둘러보는 중)'}"
        )

    def _maybe_reply(self, convo: str, new_player: list, state: dict):
        status = self._self_status(state)
        # 이 스레드가 '무엇을 보고 답하는지'를 로그로 노출(상황 + 새 메시지).
        print(f"[responder] 👁 보는정보 | 내상황[{status}] | 새채팅{new_player[-2:]}")
        user = (
            "[지금 내(whoami_rwl) 실제 상황] "
            + status
            + "\n\n[인게임 채팅 최근 대화 흐름] (너 자신은 <whoami_rwl>로 나와):\n"
            + convo
            + "\n\n위 대화에서 맨 끝 새 메시지가 너(whoami_rwl — rwl/who/whoami/후엠아이 등으로도 "
            "불림)에게 하는 말이거나, 너와 이어지고 있는 대화면 respond로 '대화 맥락에 맞게' "
            "자연스럽게 이어서 답해. 누가 너를 부르면(예: 'rwl아') 반드시 답하고, 앞에서 무슨 "
            "얘기 중이었는지 기억해서 동문서답하지 마. **답할 땐 위 '실제 상황'을 반영해 사실대로 "
            "말해 — 안 하고 있는 일을 하고 있다고 지어내지 마.** "
            "그리고 이 대화에서 앞으로 플레이에 도움될 지식·조언·약속을 배웠으면 respond의 "
            "remember에 한 줄로 적어 교훈으로 남겨(예: 누가 알려준 공략, 약속한 장소, 주의사항). "
            "딱히 새로 기억할 게 없으면 remember는 비워둬. "
            "너와 무관한 사람들끼리의 잡담이면 아무 도구도 부르지 마(침묵)."
        )
        try:
            # 27B, thinking OFF: 채팅은 응답성이 생명 — thinking ON이면 1회 ~40s+라
            # 사람이 답을 한참 기다림. 빠른 자연스러운 답이 깊은 추론보다 중요.
            msg = self.llm.chat(
                [
                    {"role": "system", "content": PERSONA},
                    {"role": "user", "content": user},
                ],
                tools=[RESPOND_TOOL],
                enable_thinking=False,
            )
        except Exception as e:
            print(f"[responder] ChatCompletionClient 호출 실패: {e}")
            return
        for tc in msg.get("tool_calls") or []:
            if tc["function"]["name"] == "respond":
                try:
                    args = json.loads(tc["function"].get("arguments") or "{}")
                except json.JSONDecodeError:
                    continue
                txt = (args.get("message") or "").strip()
                if txt:
                    self._send({"type": "chat", "message": txt[:200]})
                    print(f"[responder] 💬 답함: {txt}")
                # 27B가 직접 '교훈으로 남길지' 판단 → 있으면 바로 lessons에 기록.
                lesson = (args.get("remember") or "").strip()
                if lesson:
                    self.mem.append_lesson("(대화에서 배움) " + lesson)
                    print(f"[responder] 📚 교훈 저장: {lesson}")
                return
