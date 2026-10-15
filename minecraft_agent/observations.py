"""Observations."""

from __future__ import annotations

import json
import re

_BORING_BLOCKS = {
    "air",
    "cave_air",
    "void_air",
    "stone",
    "deepslate",
    "bedrock",
    "dirt",
    "granite",
    "diorite",
    "andesite",
    "tuff",
    "gravel",
    "netherrack",
    "end_stone",
    "cobbled_deepslate",
    "calcite",
}


def _cnt(st: dict, it: str) -> int:
    """Total count of an item (by short id) across the bot's inventory."""
    if not it:
        return 0
    return sum(
        i.get("count", 0)
        for i in st.get("inventory", [])
        if i.get("item", "").split(":")[-1] == it
    )


def notable_blocks(s: dict):
    """Nearest interactable blocks (skip bulk terrain) as (dist2, name, x, y, z)."""
    p = s.get("pos", {})
    px, py, pz = p.get("x", 0), p.get("y", 0), p.get("z", 0)
    out = []
    for b in s.get("nearbyBlocks", []):
        name = b.get("block", "").split(":")[-1]
        if name and name not in _BORING_BLOCKS:
            d2 = (
                (b.get("x", 0) - px) ** 2
                + (b.get("y", 0) - py) ** 2
                + (b.get("z", 0) - pz) ** 2
            )
            out.append((d2, name, b.get("x"), b.get("y"), b.get("z")))
    out.sort()
    return out


def new_user_chats(state: dict, last_marker, bot_name: str):
    """Return (new_player_messages, new_marker) — player chat lines that arrived
    since last_marker, excluding the bot's own and system/quest broadcasts.
    last_marker=None means startup: ignore pre-existing backlog, just record pos.

    Heuristic: real player chat renders as "<name> message". System messages
    (quests, joins, deaths) lack the <...> prefix, so we skip them — reacting to
    every server broadcast would waste Planner calls. Loosen later if needed."""
    raw = state.get("recentChat") or []
    if not raw:
        return [], last_marker
    if last_marker is None:
        fresh = []  # startup: ignore backlog
    elif last_marker in raw:
        fresh = raw[raw.index(last_marker) + 1 :]
    else:
        fresh = raw  # marker rolled off buffer
    out = []
    for m in fresh:
        clean = re.sub("§.", "", m).strip()  # strip MC color codes
        is_player = "<" in clean and ">" in clean and f"<{bot_name}>" not in clean
        is_operator = clean.startswith("[Server]")  # console /say = operator coaching
        if is_player or is_operator:
            out.append(clean)
    return out, raw[-1]


def summarize_state(s: dict) -> str:
    if not s.get("ready"):
        return "월드 미준비(아직 인게임 아님)."
    p = s.get("pos", {})
    lines = [
        f"이름={s.get('name')} 차원={s.get('dimension')} 제어={'on' if s.get('enabled') else 'off'}",
        f"위치=({p.get('x', 0):.1f},{p.get('y', 0):.1f},{p.get('z', 0):.1f}) "
        f"yaw={s.get('yaw', 0):.0f} pitch={s.get('pitch', 0):.0f} 땅={s.get('onGround')}",
        f"체력={s.get('health')}/{s.get('maxHealth')} 배고픔={s.get('food')} 경험치Lv={s.get('xpLevel')}",
    ]
    air = s.get("air", 300)
    if isinstance(air, (int, float)) and air < 300:
        lines.append(
            f"⚠️ 숨={air}/300 — 너 지금 물속이야! 익사로 죽으면 다 잃어. "
            f"당장 swim_up 도구를 불러 수면 위로 올라가(물 밑은 그만 파)."
        )
    if "timeOfDay" in s:
        t = s.get("timeOfDay", 0)
        if t < 2000:
            phase = "아침"
        elif t < 9000:
            phase = "낮(안전)"
        elif t < 11500:
            phase = "늦은 오후"
        elif t < 12800:
            phase = "🌆해질녘 — 곧 밤! 지금쯤 침대로 갈 때"
        elif t < 13500:
            phase = "🌙밤 시작"
        elif t < 22000:
            phase = "🌙한밤(몹 위험)"
        else:
            phase = "🌄새벽(곧 아침)"
        lines.append(
            f"시간={t}/24000 ({phase}) [Day {s.get('dayCount')}] "
            f"※밤(13000~23000)엔 좀비·스켈레톤·거미가 나와 위험. 자정=18000"
        )
    held = s.get("heldItem") or {}
    lines.append(
        f"든것=슬롯{s.get('selectedSlot')} {held.get('item', '빈손')} x{held.get('count', '')}"
    )

    inv = [
        f"{it.get('slot')}:{it.get('item')}x{it.get('count')}"
        for it in s.get("inventory", [])
        if it.get("item")
    ]
    lines.append("내 인벤토리(전부)=" + (", ".join(inv) if inv else "비어있음"))

    look = s.get("lookingAt") or {}
    if look:
        lines.append(f"바라보는중={json.dumps(look, ensure_ascii=False)}")

    # 지형(돌/흙 등 대량블록)은 개수만(수백 개라 나열 불가). 그 외 블록은 전부 상세히.
    hist: dict[str, int] = {}
    for b in s.get("nearbyBlocks", []):
        name = b.get("block", "").split(":")[-1]
        if name in _BORING_BLOCKS:
            hist[name] = hist.get(name, 0) + 1
    top = sorted(hist.items(), key=lambda kv: -kv[1])
    if top:
        lines.append(
            f"주변 지형블록 개수(r={s.get('blockScanRadius')}): "
            + ", ".join(f"{n}x{c}" for n, c in top if n and n != "air")
        )
    # 지형 외 모든 블록: 종류·좌표·거리·사거리닿는지(닿O/멈X). 잎/통나무도 종류로 구분됨.
    notable = notable_blocks(s)
    if notable:
        # 통나무(나무 줄기)는 핵심 자원이라 맨 위에 따로 부각 — 안 그러면 잎 수십 개에 파묻혀 안 보임.
        woods = [
            (d2, n, x, y, z)
            for d2, n, x, y, z in notable
            if "log" in n or n.endswith("_wood") or n == "wood"
        ]
        if woods:
            lines.append(
                "🌳 통나무(나무 줄기 — 캐면 목재가 나옴. 맨손으로도 캐짐): "
                + ", ".join(
                    f"{n}({x},{y},{z} {d2**0.5:.1f}m "
                    f"{'★지금 닿음-바로 캘수있음' if d2**0.5 <= 4.5 else '멈X-가까이가야함'})"
                    for d2, n, x, y, z in woods[:12]
                )
            )
        # 광석도 핵심 자원이라 따로 부각 — 안 그러면 잡블록 50개에 파묻혀 못 캔다.
        ores = [
            (d2, n, x, y, z)
            for d2, n, x, y, z in notable
            if n.endswith("_ore") or n == "ancient_debris"
        ]
        if ores:
            lines.append(
                "⛏ 광석(돌곡괭이+로 캐면 자원이 나옴 — 보이면 mine_block로 바로 캐!): "
                + ", ".join(
                    f"{n}({x},{y},{z} {d2**0.5:.1f}m "
                    f"{'★지금 닿음-바로 캘수있음' if d2**0.5 <= 4.5 else '멈X-가까이가야함'})"
                    for d2, n, x, y, z in ores[:12]
                )
            )
        lines.append(
            "주변 블록(지형 제외) — 종류(좌표 거리 사거리): "
            + ", ".join(
                f"{n}({x},{y},{z} {d2**0.5:.1f}m {'닿O' if d2**0.5 <= 4.5 else '멈X'})"
                for d2, n, x, y, z in notable[:50]
            )
        )

    ents = sorted(s.get("entities", []), key=lambda e: e.get("distance", 1e9))
    drops = [e for e in ents if e.get("type", "").endswith(":item")]
    mobs = [e for e in ents if not e.get("type", "").endswith(":item")]
    if drops:
        lines.append(
            "땅에 떨어진 아이템(좌표 거리): "
            + ", ".join(
                f"{e.get('name')}({e.get('pos', {}).get('x', 0):.0f},{e.get('pos', {}).get('y', 0):.0f},"
                f"{e.get('pos', {}).get('z', 0):.0f} {e.get('distance', 0):.1f}m)"
                for e in drops[:15]
            )
        )
    if mobs:
        lines.append(
            "주변 생물(종류 좌표 거리): "
            + ", ".join(
                f"{e.get('name')}/{e.get('type', '').split(':')[-1]}("
                f"{e.get('pos', {}).get('x', 0):.0f},{e.get('pos', {}).get('y', 0):.0f},"
                f"{e.get('pos', {}).get('z', 0):.0f} {e.get('distance', 0):.1f}m)"
                for e in mobs[:12]
            )
        )

    dt = s.get("distantTrees") or []
    if dt:
        px, pz = p.get("x", 0), p.get("z", 0)

        def _dir(tx, tz):  # +x=동 -x=서 +z=남 -z=북 (마크 좌표계)
            dx, dz = tx - px, tz - pz
            return (
                ("동" if dx > 0 else "서")
                if abs(dx) >= abs(dz)
                else ("남" if dz > 0 else "북")
            )

        dt = sorted(dt, key=lambda b: b.get("dist", 999))[:8]
        lines.append(
            f"먼 나무 탐지(스캔 r={s.get('distantScanRadius')}, 화면보다 좁지만 근거리보단 넓음): "
            + ", ".join(
                f"{b.get('block')}({b.get('x')},{b.get('y')},{b.get('z')} "
                f"~{b.get('dist')}m {_dir(b.get('x', px), b.get('z', pz))}쪽)"
                for b in dt
            )
            + " — goto로 그 좌표 가면 접근함"
        )

    bar = s.get("baritone", {})
    lines.append(
        f"baritone: avail={bar.get('available')} active={bar.get('active')} "
        f"goal={bar.get('goal')}"
    )
    mt = s.get("mineTarget")
    if mt:
        lines.append(
            f"※지금 채굴중인 블록 mineTarget=({mt['x']},{mt['y']},{mt['z']}) — 깨질 때까지 기다려"
        )
    return "\n".join(lines)
