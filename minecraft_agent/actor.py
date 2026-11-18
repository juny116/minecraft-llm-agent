"""Actor."""

from __future__ import annotations

import json
import re
import time

from .action_tools import ACTOR_TOOLS, TOOL_TO_CMD
from .chat_responder import Responder
from .file_memory import FileMemory
from .game_client import GameClient
from .model_client import ChatCompletionClient, UsageBudget
from .observations import _cnt, notable_blocks, summarize_state
from .planner import Planner, progress_summary
from .prompts import ACTOR_GUIDE, PERSONA
from .runtime_options import AgentOptions


def run_actor(cfg: AgentOptions):
    meter = UsageBudget(cfg)
    actor = ChatCompletionClient(cfg.actor, meter)
    mem = FileMemory(cfg.mem_dir)
    planner = Planner(ChatCompletionClient(cfg.planner, meter), mem)
    # Parallel chat responder — replies on its OWN socket so the Actor never stops
    # walking/mining to talk. Uses the 27B (planner-tier) model with thinking ON:
    # chat isn't time-critical, so it reasons deeply and judges lesson-worthiness itself.
    Responder(ChatCompletionClient(cfg.planner, meter), mem, cfg.bot_host, cfg.bot_port)

    # Connect, waiting if the client isn't up yet (so "just run it" works).
    while True:
        try:
            bot = GameClient(cfg.bot_host, cfg.bot_port)
            break
        except OSError as e:
            print(f"[bot] 클라 대기({e}) — 5s 후 재시도")
            time.sleep(5.0)
    # Headless client boots to the menu — make sure we're in the world first.
    bot.ensure_in_game(cfg.server_host, cfg.server_port)
    print("[bot] enable ->", bot.enable())
    bot.send({"type": "cancel"})  # wipe any stale Baritone goal
    bot.send({"type": "mine_block"})  # wipe any stale mineTarget from a prior run
    print("=" * 60 + "\n" + PERSONA + "\n" + "=" * 60)

    recent: list[str] = []  # last few actions, fed back so whoami_rwl doesn't loop
    failed_blocks: set = (
        set()
    )  # mine_block targets that wouldn't break (occluded/bugged)
    noop_goto = 0  # consecutive goto/goto_near that didn't actually move
    explore_i = 0  # cycles N/E/S/W when forcing a real exploration move
    respawn_tries = 0
    actions_since_plan = 0
    last_plan = time.monotonic()
    last_state = (
        None  # latest snapshot, so request_plan can give the Planner live progress
    )

    def request_plan(reason: str):
        nonlocal actions_since_plan, last_plan
        prog = ""
        try:
            prog = progress_summary(last_state) if last_state else ""
        except Exception:
            prog = ""
        planner.request(reason, prog)
        actions_since_plan = 0
        last_plan = time.monotonic()

    try:
        while True:
            stop = meter.over_cap()
            if stop:
                print(f"[stop] {stop}")
                break

            try:
                state = bot.state()
            except (ConnectionError, OSError) as e:
                print(f"[bot] 연결 끊김({e}) — 재접속 시도(클라 재시작?)")
                bot.reconnect()
                continue
            last_state = state  # keep latest for request_plan -> Planner progress

            # Fell out of the world (kicked/disconnected/server restart) -> rejoin.
            if not state.get("ready"):
                print("[bot] 월드 밖 감지 — 서버 재접속")
                bot.ensure_in_game(cfg.server_host, cfg.server_port)
                bot.enable()
                continue

            # (Drowning is now handled by the bot's own choice: the observation shows a
            #  low-air warning and the actor can call the swim_up tool to rise. No forced
            #  override.)

            # Reflex: dead -> respawn + reflect. Keep trying patiently — never exit:
            # a frozen client (window minimised) ignores respawn until restored.
            if state.get("ready") and (state.get("health") or 0) <= 0:
                respawn_tries += 1
                bot.send({"type": "respawn"})
                if respawn_tries == 1:
                    print("[respawn] health<=0, sending respawn")
                    mem.record_event("- (죽음) 리스폰했다")
                    request_plan("죽었다 — 왜 죽었고 다음엔 어떻게 피할지")
                elif respawn_tries % 5 == 0:
                    print(
                        f"[respawn] {respawn_tries}회 시도했는데 안 살아남 — "
                        "MC 창이 최소화/멈춤 상태인지 확인하세요(계속 재시도 중)"
                    )
                time.sleep(2.0 if respawn_tries < 5 else 10.0)  # back off if persistent
                continue
            respawn_tries = 0

            # 최근 채팅 대화를 '항상' 관찰에 넣는다. (새 줄만 보면 한 번 보고 마커가 넘어가
            # 다음 행동 땐 까먹는다 → "여기로 와" 같은 요청을 잊고 안 감.) 자기(whoami_rwl)
            # 말까지 포함해서, 무슨 부탁/약속이 오갔는지 행동을 정할 때 계속 참고하게 한다.
            raw_chat = state.get("recentChat") or []
            # 플레이어 채팅(<이름> ...)뿐 아니라 운영자 코칭([Server] ...)도 행동 결정에 포함.
            # ([Server]는 콘솔 /say = 관리자 지시 → 행동으로 따라야 하는 코칭이라 Actor가 봐야 함.)
            convo_lines = [
                re.sub("§.", "", m).strip()
                for m in raw_chat[-10:]
                if ("<" in m and ">" in m)
                or re.sub("§.", "", m).strip().startswith("[Server]")
            ]
            chat_txt = ""
            if convo_lines:
                chat_txt = (
                    "\n\n최근 채팅 대화(맥락 — 너=<whoami_rwl>, [Server]=운영자 지시): \n"
                    + "\n".join(convo_lines)
                    + "\n→ 누가 너한테 뭘 해달라고 했으면(예: '여기로 와', '나무 캐줘', '[Server] …') 그게 아직 "
                    "안 끝났으면 행동으로 응해. 운영자([Server]) 지시는 우선해서 따라. 이미 처리한 요청은 다시 안 해도 돼."
                )
                print(f"[chat] 최근 대화 {len(convo_lines)}줄 관찰에 포함")

            obs = summarize_state(state)
            print("\n--- observation ---\n" + obs)
            mem.remember_places(notable_blocks(state))  # accumulate the map

            recent_txt = (
                "\n\n방금 한 행동들(최근순):\n" + "\n".join(recent[-5:])
                if recent
                else ""
            )
            messages = [
                {"role": "system", "content": PERSONA + "\n\n" + ACTOR_GUIDE},
                {
                    "role": "user",
                    "content": "현재 관찰:\n"
                    + obs
                    + chat_txt
                    + "\n\n나의 기억:\n"
                    + mem.recall(state)
                    + recent_txt
                    + "\n\nwhoami_rwl답게 다음 행동 하나만 정해.",
                },
            ]
            try:
                msg = actor.chat(messages, tools=ACTOR_TOOLS, enable_thinking=False)
            except Exception as e:
                print(f"[actor] 호출 실패, 잠시 후 재시도: {e}")
                time.sleep(cfg.loop_delay)
                continue

            calls = msg.get("tool_calls") or []
            if not calls:
                say = (msg.get("content") or "").strip()
                print(f"[actor] (관망) {say[:200]}")
                mem.record_event(f"- (생각) {say[:200]}")

            for tc in calls:
                fn = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"].get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}

                # craft: 봇이 'planks' 같은 generic 이름을 쓰면 MC 실제 아이템 id로 보정
                # (planks는 아이템이 아니고 oak_planks 등 — 가진 통나무 종류로 변환).
                if fn == "craft":
                    item = (args.get("item") or "").split(":")[-1]
                    if item in (
                        "planks",
                        "plank",
                        "wood_planks",
                        "wooden_planks",
                        "wood",
                    ):
                        woodlogs = [
                            i.get("item", "").split(":")[-1]
                            for i in state.get("inventory", [])
                            if "_log" in (i.get("item") or "")
                        ]
                        if woodlogs:
                            item = woodlogs[0].replace("_log", "_planks")
                            print(
                                f"[act] craft 'planks' → '{item}'(가진 통나무 기준)로 보정"
                            )
                    # 3x3 레시피(도구·가구 등)는 제작대가 '열려' 있어야 만들어진다. 안 그러면
                    # 플레이어 2x2 그리드라 조용히 no-op(곡괭이 0개)인데 ack는 ok로 와서 봇이
                    # 성공한 줄 안다 → 도구 진행 영영 막힘. 그래서: ①근처 제작대를 자동으로 열고
                    # ②제작 후 인벤 증가로 성공을 검증, 실패면 봇에 명확히 알려준다.
                    table_free = item in (
                        "stick",
                        "crafting_table",
                        "torch",
                    ) or item.endswith("_planks")
                    before = _cnt(state, item)
                    # 과잉생산 방지: 이미 충분히 가진 건 그만 만든다(막대 200+·곡괭이 4개씩
                    # 만들어 인벤을 막아 다음 진행을 방해해 옴). 임계치는 넉넉히 높여 정상 제작은
                    # 절대 안 막고, 명백한 낭비만 막아 다른 일을 하게 유도한다.
                    overcap = {
                        "stick": 128,
                        "crafting_table": 2,
                        "furnace": 2,
                        "torch": 64,
                    }.get(item)
                    if overcap is None and any(
                        item.endswith(s)
                        for s in ("_pickaxe", "_axe", "_sword", "_shovel", "_hoe")
                    ):
                        overcap = 2  # 도구는 여분 1개까지만
                    if overcap is not None and before >= overcap:
                        print(f"[act] craft({item}) 생략 — 이미 {before}개(충분)")
                        mem.record_event(
                            f"- (제작 생략) {item} 이미 {before}개라 충분 — 그만 만들고 "
                            f"여분은 상자에 store하거나 다음 목표(채굴·집짓기)로 넘어가."
                        )
                        recent.append(f"craft({item}) 생략: 이미 {before}개 충분")
                        actions_since_plan += 1
                        continue
                    if not table_free:  # open a nearby crafting table first
                        # Prefer the snapshot's explicit nearest-table field (reliable);
                        # fall back to scanning nearbyBlocks (distance-capped, may miss it).
                        tb = state.get("craftingTable")
                        if not tb:
                            p = state.get("pos", {})
                            best = None
                            for b in state.get("nearbyBlocks", []):
                                if (b.get("block", "") or "").endswith(
                                    "crafting_table"
                                ):
                                    d = (
                                        (b["x"] + 0.5 - p.get("x", 0)) ** 2
                                        + (b["z"] + 0.5 - p.get("z", 0)) ** 2
                                    ) ** 0.5
                                    if best is None or d < best[0]:
                                        best = (d, b)
                            tb = best[1] if best else None
                        # No table placed nearby but we own one → auto-place it.
                        # (select_slot only reaches the hotbar, so a table stuck in the
                        # main inventory was un-placeable — the bot looped forever here.)
                        if not tb and _cnt(state, "crafting_table") > 0:
                            bot.send({"type": "cancel"})
                            bot.send({"type": "equip", "item": "crafting_table"})
                            # look near-straight-down (steep pitch places on the ground
                            # right at our feet; shallow angles often hit nothing).
                            bot.send(
                                {
                                    "type": "look",
                                    "yaw": state.get("yaw", 0),
                                    "pitch": 85,
                                }
                            )
                            time.sleep(0.3)
                            bot.send(
                                {"type": "use"}
                            )  # place the held table on the ground
                            time.sleep(0.8)  # server round-trip before it appears
                            tb = None
                            for _ in range(2):
                                try:
                                    tb = bot.state().get("craftingTable")
                                except (ConnectionError, OSError):
                                    tb = None
                                if tb:
                                    break
                                time.sleep(0.5)
                            if tb:
                                print(
                                    f"[act] 제작대 자동 설치 성공({tb['x']},{tb['y']},{tb['z']})"
                                )
                                mem.record_event(
                                    "- (제작대 자동설치) 바닥에 제작대를 놓았다."
                                )
                            else:
                                print(
                                    "[act] 제작대 자동 설치 시도했으나 실패(자리 부적합)"
                                )
                        if tb:
                            p = state.get("pos", {})
                            d = (
                                (tb["x"] + 0.5 - p.get("x", 0)) ** 2
                                + (tb["z"] + 0.5 - p.get("z", 0)) ** 2
                            ) ** 0.5
                            if d > 3.0:
                                bot.send(
                                    {
                                        "type": "goto_near",
                                        "x": tb["x"],
                                        "y": tb["y"],
                                        "z": tb["z"],
                                        "range": 2,
                                    }
                                )
                                _wait_baritone(bot, timeout=60)
                            bot.send({"type": "cancel"})
                            bot.send(
                                {
                                    "type": "use_block",
                                    "x": tb["x"],
                                    "y": tb["y"],
                                    "z": tb["z"],
                                }
                            )
                            time.sleep(0.5)
                            print(
                                f"[act] craft 전 제작대({tb['x']},{tb['y']},{tb['z']}) 자동 열기"
                            )
                    cmd = {"type": "craft", "item": item}
                    if "count" in args:
                        cmd["count"] = args["count"]
                    resp = bot.send(cmd)
                    time.sleep(0.3)
                    try:
                        after = _cnt(bot.state(), item)
                    except (ConnectionError, OSError):
                        after = before + 1  # can't verify; assume ok
                    if not table_free and after <= before:
                        if (
                            tb
                        ):  # a table was found+opened → the real problem is materials
                            note = (
                                f"- (제작 실패) {item} 못 만듦 — 제작대는 열렸으니 '재료 부족'이야. "
                                f"레시피 재료를 확인해(곡괭이=판자3+막대2, 도끼=판자3+막대2, 화로=돌8, "
                                f"돌도구=돌3+막대2). 막대가 없으면 판자로 막대부터 만들고, 돌이 모자라면 더 캐."
                            )
                            recent.append(f"craft({item}) 실패→재료 부족(막대/돌 확인)")
                        else:  # no table nearby
                            note = (
                                f"- (제작 실패) {item} 못 만듦 — 근처에 제작대가 없어. crafting_table을 "
                                f"바닥에 놓고 use_block로 연 뒤 만들어야 해(3x3 도구·가구)."
                            )
                            recent.append(f"craft({item}) 실패→제작대 놓고 열어야 함")
                        print(
                            f"[act] -> craft({item}) no-op 감지(델타0, table={'O' if tb else 'X'}) → 피드백"
                        )
                        mem.record_event(note)
                    else:
                        print(f"[act] -> craft({item}) => {resp} (+{after - before})")
                        mem.record_event(f"-> craft({item})")
                        recent.append(f"craft({item})")
                    actions_since_plan += 1
                    continue

                # swim_up: the bot's own escape-from-water action (replaces the old forced
                # reflex). Burst of look-up + hold-jump (= swim up) + forward, breaking the
                # block overhead in case it's trapped under a ceiling, then release.
                if fn == "swim_up":
                    try:
                        bot.send({"type": "cancel"})
                        bot.send(
                            {"type": "look", "yaw": state.get("yaw", 0), "pitch": -90}
                        )
                        bot.send({"type": "jump", "on": True})
                        bot.send({"type": "move", "forward": 1})
                        p = state.get("pos", {})
                        bot.send(
                            {
                                "type": "mine_block",
                                "x": int(round(p.get("x", 0))),
                                "y": int(p.get("y", 0)) + 2,
                                "z": int(round(p.get("z", 0))),
                            }
                        )
                        time.sleep(1.2)  # hold the ascent briefly
                        bot.send({"type": "jump", "on": False})
                        bot.send({"type": "mine_block"})
                        bot.send({"type": "stop"})
                    except (ConnectionError, OSError) as e:
                        print(f"[bot] 명령 중 끊김({e}) — 재접속")
                        bot.reconnect()
                        break
                    print("[act] -> swim_up (수면 상승 시도)")
                    mem.record_event("-> swim_up(수면 상승)")
                    recent.append("swim_up")
                    actions_since_plan += 1
                    continue

                # Meta tools steer thinking, not the bot.
                if fn == "consult_planner":
                    reason = args.get("reason", "(이유 미상)")
                    print(f"[actor] consult_planner: {reason}")
                    mem.record_event(f"- (사색요청) {reason}")
                    request_plan("whoami_rwl가 도움 요청: " + reason)
                    continue
                if fn == "report_goal":
                    status, note = args.get("status", "?"), args.get("note", "")
                    print(f"[actor] report_goal: {status} — {note}")
                    mem.record_event(f"- (목표 {status}) {note}")
                    request_plan(f"목표 {status}: {note}")
                    continue

                # mine_block: approach if out of reach, then break — but GIVE UP if
                # it isn't breaking (out of reach / occluded / protected / bug), so
                # the bot never gets stuck forever on one block.
                if fn == "mine_block":
                    try:
                        bx, by, bz = int(args["x"]), int(args["y"]), int(args["z"])
                    except (KeyError, ValueError, TypeError):
                        print("[actor] mine_block 좌표 누락")
                        continue
                    if (bx, by, bz) in failed_blocks:  # already proven un-breakable
                        print(f"[act] ({bx},{by},{bz})는 안 깨지던 블록 — 건너뜀")
                        mem.record_event(
                            f"- ({bx},{by},{bz})는 안 깨지는 블록(버그/가림). 다른 통나무를 고르자."
                        )
                        continue
                    p = state.get("pos", {})
                    dist = (
                        (bx + 0.5 - p.get("x", 0)) ** 2
                        + (by + 0.5 - (p.get("y", 0) + 1.62)) ** 2
                        + (bz + 0.5 - p.get("z", 0)) ** 2
                    ) ** 0.5
                    if dist > 4.0:  # too far to reach -> walk up first
                        print(f"[act] mine_block 대상 {dist:.1f}블록 멀어 접근")
                        bot.send(
                            {"type": "goto_near", "x": bx, "y": by, "z": bz, "range": 2}
                        )
                        _wait_baritone(bot, timeout=60)
                    bot.send({"type": "cancel"})  # baritone off so mining runs
                    bot.send({"type": "mine_block", "x": bx, "y": by, "z": bz})
                    print(f"[act] -> mine_block({bx},{by},{bz})")
                    mem.record_event(f"-> mine_block({bx},{by},{bz})")
                    recent.append(f"mine_block({bx},{by},{bz})")
                    actions_since_plan += 1
                    if not _wait_mine(bot, bx, by, bz, timeout=12):
                        bot.send({"type": "mine_block"})  # clear target = give up
                        failed_blocks.add((bx, by, bz))  # never retry this one
                        mem.record_event(
                            f"- (채굴포기) ({bx},{by},{bz}) 안 깨짐(가림/버그). 이 블록은 포기하고 다른 통나무로."
                        )
                        print("[act] 채굴 진행 없음 → 포기(기억해둠)")
                    continue

                # use_block: approach if out of reach, then right-click the block
                # (sleep in bed, open chest/door). Like mine_block but a single interact.
                if fn == "use_block":
                    try:
                        bx, by, bz = int(args["x"]), int(args["y"]), int(args["z"])
                    except (KeyError, ValueError, TypeError):
                        print("[actor] use_block 좌표 누락")
                        continue
                    p = state.get("pos", {})
                    dist = (
                        (bx + 0.5 - p.get("x", 0)) ** 2
                        + (by + 0.5 - (p.get("y", 0) + 1.62)) ** 2
                        + (bz + 0.5 - p.get("z", 0)) ** 2
                    ) ** 0.5
                    if dist > 3.0:  # must be close to interact (esp. beds)
                        print(f"[act] use_block 대상 {dist:.1f}블록 멀어 접근")
                        bot.send(
                            {"type": "goto_near", "x": bx, "y": by, "z": bz, "range": 2}
                        )
                        _wait_baritone(bot, timeout=60)
                    bot.send({"type": "cancel"})  # baritone off so the interact runs
                    try:
                        resp = bot.send(
                            {"type": "use_block", "x": bx, "y": by, "z": bz}
                        )
                    except (ConnectionError, OSError) as e:
                        print(f"[bot] 명령 중 끊김({e}) — 재접속")
                        bot.reconnect()
                        break
                    print(f"[act] -> use_block({bx},{by},{bz}) => {resp}")
                    mem.record_event(f"-> use_block({bx},{by},{bz})")
                    recent.append(f"use_block({bx},{by},{bz})")
                    actions_since_plan += 1
                    continue

                # store: deposit items into a chest. If chest coords are given, walk up,
                # open it (use_block), then store; otherwise store into whatever's open.
                if fn == "store":
                    item = args.get("item")
                    if all(k in args for k in ("x", "y", "z")):
                        try:
                            bx, by, bz = int(args["x"]), int(args["y"]), int(args["z"])
                        except (ValueError, TypeError):
                            print("[actor] store 좌표 오류")
                            continue
                        p = state.get("pos", {})
                        dist = (
                            (bx + 0.5 - p.get("x", 0)) ** 2
                            + (by + 0.5 - (p.get("y", 0) + 1.62)) ** 2
                            + (bz + 0.5 - p.get("z", 0)) ** 2
                        ) ** 0.5
                        if dist > 3.0:
                            print(f"[act] store 상자 {dist:.1f}블록 멀어 접근")
                            bot.send(
                                {
                                    "type": "goto_near",
                                    "x": bx,
                                    "y": by,
                                    "z": bz,
                                    "range": 2,
                                }
                            )
                            _wait_baritone(bot, timeout=60)
                        bot.send({"type": "cancel"})
                        bot.send(
                            {"type": "use_block", "x": bx, "y": by, "z": bz}
                        )  # open the chest
                        time.sleep(
                            0.7
                        )  # let the container menu open (server round-trip)
                    else:
                        # No coords: store no-ops silently unless a chest is open. The bot
                        # owns chests but they sit in the *main* inventory (un-place-able via
                        # select_slot), so it loops on store(ok:True) without ever depositing.
                        # Locate a placed chest nearby; if none, auto-place one (mirror craft).
                        def _find_chest(st):
                            pp = st.get("pos", {})
                            best = None
                            for b in st.get("nearbyBlocks", []):
                                bid = b.get("block", "") or ""
                                if bid == "minecraft:chest" or (
                                    bid.endswith("chest") and "ender" not in bid
                                ):
                                    dd = (
                                        (b["x"] + 0.5 - pp.get("x", 0)) ** 2
                                        + (b["z"] + 0.5 - pp.get("z", 0)) ** 2
                                    ) ** 0.5
                                    if best is None or dd < best[0]:
                                        best = (dd, b)
                            return best[1] if best else None

                        ch = _find_chest(state)
                        if not ch and _cnt(state, "chest") > 0:
                            bot.send({"type": "cancel"})
                            bot.send({"type": "equip", "item": "chest"})
                            bot.send(
                                {
                                    "type": "look",
                                    "yaw": state.get("yaw", 0),
                                    "pitch": 85,
                                }
                            )
                            time.sleep(0.3)
                            bot.send({"type": "use"})  # place the chest on the ground
                            time.sleep(0.8)
                            for _ in range(2):
                                try:
                                    ch = _find_chest(bot.state())
                                except (ConnectionError, OSError):
                                    ch = None
                                if ch:
                                    break
                                time.sleep(0.5)
                            if ch:
                                print(
                                    f"[act] 상자 자동 설치 성공({ch['x']},{ch['y']},{ch['z']})"
                                )
                                mem.record_event(
                                    "- (상자 자동설치) 바닥에 상자를 놓았다 — 앞으로 이 좌표로 store/take 해."
                                )
                            else:
                                print(
                                    "[act] 상자 자동 설치 시도했으나 실패(자리 부적합)"
                                )
                        if ch:
                            p = state.get("pos", {})
                            d = (
                                (ch["x"] + 0.5 - p.get("x", 0)) ** 2
                                + (ch["z"] + 0.5 - p.get("z", 0)) ** 2
                            ) ** 0.5
                            if d > 3.0:
                                bot.send(
                                    {
                                        "type": "goto_near",
                                        "x": ch["x"],
                                        "y": ch["y"],
                                        "z": ch["z"],
                                        "range": 2,
                                    }
                                )
                                _wait_baritone(bot, timeout=60)
                            bot.send({"type": "cancel"})
                            bot.send(
                                {
                                    "type": "use_block",
                                    "x": ch["x"],
                                    "y": ch["y"],
                                    "z": ch["z"],
                                }
                            )
                            time.sleep(0.7)
                            print(
                                f"[act] store 전 상자({ch['x']},{ch['y']},{ch['z']}) 자동 열기"
                            )
                    s_before = _cnt(state, item) if item else None
                    cmd = {"type": "store", **({"item": item} if item else {})}
                    try:
                        resp = bot.send(cmd)
                    except (ConnectionError, OSError) as e:
                        print(f"[bot] 명령 중 끊김({e}) — 재접속")
                        bot.reconnect()
                        break
                    time.sleep(0.3)
                    if item and s_before:  # verify the deposit actually happened
                        try:
                            s_after = _cnt(bot.state(), item)
                        except (ConnectionError, OSError):
                            s_after = 0
                        if (
                            s_after >= s_before
                        ):  # nothing left the bag → no chest was open
                            print(f"[act] -> store({item}) no-op 감지(델타0) → 피드백")
                            mem.record_event(
                                f"- (보관 실패) {item} 상자에 못 넣음 — 열린 상자가 없어. "
                                f"상자(chest)를 바닥에 use로 놓고 그 좌표로 store하거나, "
                                f"이미 놓은 상자가 있으면 그 좌표를 store에 줘."
                            )
                            recent.append(f"store({item}) 실패→상자 놓고 좌표 줘야 함")
                            actions_since_plan += 1
                            continue
                    print(f"[act] -> store({item or '전체'}) => {resp}")
                    mem.record_event(f"-> store({item or '전체'})")
                    recent.append(f"store({item or '전체'})")
                    actions_since_plan += 1
                    continue

                # take: pull items out of a chest/furnace. Mirrors store — open it if coords
                # given, then take. Needed to retrieve smelted iron_ingot from a furnace.
                if fn == "take":
                    item = args.get("item")
                    if all(k in args for k in ("x", "y", "z")):
                        try:
                            bx, by, bz = int(args["x"]), int(args["y"]), int(args["z"])
                        except (ValueError, TypeError):
                            print("[actor] take 좌표 오류")
                            continue
                        p = state.get("pos", {})
                        dist = (
                            (bx + 0.5 - p.get("x", 0)) ** 2
                            + (by + 0.5 - (p.get("y", 0) + 1.62)) ** 2
                            + (bz + 0.5 - p.get("z", 0)) ** 2
                        ) ** 0.5
                        if dist > 3.0:
                            print(f"[act] take 대상 {dist:.1f}블록 멀어 접근")
                            bot.send(
                                {
                                    "type": "goto_near",
                                    "x": bx,
                                    "y": by,
                                    "z": bz,
                                    "range": 2,
                                }
                            )
                            _wait_baritone(bot, timeout=60)
                        bot.send({"type": "cancel"})
                        bot.send(
                            {"type": "use_block", "x": bx, "y": by, "z": bz}
                        )  # open it
                        time.sleep(0.7)
                    cmd = {"type": "take", **({"item": item} if item else {})}
                    try:
                        resp = bot.send(cmd)
                    except (ConnectionError, OSError) as e:
                        print(f"[bot] 명령 중 끊김({e}) — 재접속")
                        bot.reconnect()
                        break
                    print(f"[act] -> take({item or '전체'}) => {resp}")
                    mem.record_event(f"-> take({item or '전체'})")
                    recent.append(f"take({item or '전체'})")
                    actions_since_plan += 1
                    continue

                builder = TOOL_TO_CMD.get(fn)
                if not builder:
                    print(f"[actor] unknown tool {fn}")
                    continue
                # A stuck/active Baritone goal suppresses our mining & manual input
                # (mod runs them only when !baritoneActive). If the bot now wants to
                # mine/hit/use/look, cancel any lingering pathing first.
                if fn in ("mine", "attack", "use", "look_at") and (
                    state.get("baritone") or {}
                ).get("active"):
                    bot.send({"type": "cancel"})
                    print("[act] (baritone 취소 후 행동)")
                try:
                    cmd = builder(args)
                except KeyError as e:
                    print(f"[actor] {fn} missing arg {e}; args={args}")
                    continue
                try:
                    resp = bot.send(cmd)
                except (ConnectionError, OSError) as e:
                    print(f"[bot] 명령 중 끊김({e}) — 재접속")
                    bot.reconnect()
                    break
                line = f"-> {fn}({json.dumps(args, ensure_ascii=False)}) => {resp}"
                print("[act] " + line)
                mem.record_event(line)
                recent.append(f"{fn}({json.dumps(args, ensure_ascii=False)})")
                actions_since_plan += 1

                if fn in ("goto", "goto_near"):
                    try:
                        p0 = bot.state().get("pos", {})
                    except (ConnectionError, OSError):
                        p0 = {}
                    if _wait_baritone(bot, timeout=120):
                        break  # died mid-path -> respawn next iter
                    try:
                        p1 = bot.state().get("pos", {})
                    except (ConnectionError, OSError):
                        p1 = {}
                    moved = (
                        (p1.get("x", 0) - p0.get("x", 0)) ** 2
                        + (p1.get("z", 0) - p0.get("z", 0)) ** 2
                    ) ** 0.5
                    noop_goto = noop_goto + 1 if moved < 2 else 0
                    if (
                        noop_goto >= 2
                    ):  # degenerate "explore by bigger range" loop — force a real move
                        noop_goto = 0
                        # Nudge ~16 blocks (was 45). A big fling kept yanking the bot away
                        # from spots where ore was visible right next to it; a small hop
                        # breaks the local stuck without abandoning the dig site.
                        ddx, ddz = [(16, 0), (0, 16), (-16, 0), (0, -16)][explore_i % 4]
                        explore_i += 1
                        tx, tz = int(p1.get("x", 0)) + ddx, int(p1.get("z", 0)) + ddz
                        print(
                            f"[act] 제자리 goto 반복 감지 → 근처 이동 goto({tx},{tz})"
                        )
                        mem.record_event(
                            f"- (제자리맴돎 감지) 근처 {tx},{tz}쪽으로 이동(스팟 유지)"
                        )
                        try:
                            bot.send(
                                {
                                    "type": "goto",
                                    "x": tx,
                                    "y": int(p1.get("y", 70)),
                                    "z": tz,
                                }
                            )
                            _wait_baritone(bot, timeout=120)
                        except (ConnectionError, OSError):
                            bot.reconnect()

            # Backstop: guarantee reflection even if whoami_rwl never escalates.
            if (
                actions_since_plan >= cfg.backstop_actions
                or time.monotonic() - last_plan >= cfg.backstop_seconds
            ):
                request_plan("정기 점검(그동안의 행동 돌아보기)")

            time.sleep(cfg.loop_delay)
    except KeyboardInterrupt:
        print("\n[stop] interrupted")
    finally:
        bot.disable()
        bot.close()
        print(f"[done] {meter.calls} calls, {meter.tokens} tokens")


def _inv_count(st: dict) -> int:
    return sum(i.get("count", 0) for i in st.get("inventory", []) if i.get("item"))


def _drop_count(st: dict) -> int:
    return sum(1 for e in st.get("entities", []) if e.get("type", "").endswith(":item"))


def _wait_mine(bot: GameClient, x: int, y: int, z: int, timeout: float) -> bool:
    """Success = the block actually broke. A real break either lands the drop in
    the inventory (inv grows) OR spawns a drop item-entity on the ground (drop
    count grows). A server-reverted/occluded break does NEITHER, so it's a clean
    give-up signal — and this no longer false-fails when the drop lands a couple
    blocks away (breaking != collecting; collecting the drop is the bot's job)."""
    try:
        s0 = bot.state()
        base_inv, base_drops = _inv_count(s0), _drop_count(s0)
    except (ConnectionError, OSError):
        return False
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        time.sleep(1.0)
        try:
            st = bot.state()
        except (ConnectionError, OSError):
            return False
        if (st.get("health") or 0) <= 0:
            return False
        if _inv_count(st) > base_inv or _drop_count(st) > base_drops:
            print("[act] 블록 깨짐 ✓ (드롭 발생)")
            return True
    return False


def _wait_baritone(bot: GameClient, timeout: float) -> bool:
    """Block until Baritone finishes pathing (active flips false) or timeout.
    Returns True if the bot DIED while waiting — so we stop waiting immediately
    instead of sitting through the whole timeout (which made respawn take ~2min)."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        time.sleep(1.0)
        try:
            st = bot.state()
        except (ConnectionError, OSError):
            return False  # outer loop will reconnect on its next state() call
        if (st.get("health") or 0) <= 0:
            print("[act] 이동 중 사망 — baritone 대기 즉시 중단")
            return True
        if not st.get("baritone", {}).get("active"):
            print("[act] baritone 도착/정지")
            return False
    print("[act] baritone 대기 타임아웃")
    try:
        bot.send({"type": "cancel"})
    except (ConnectionError, OSError):
        pass
    return False
