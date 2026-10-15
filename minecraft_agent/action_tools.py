"""Action tools."""

from __future__ import annotations

ACTION_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "goto",
            "description": "Baritone로 지정한 블록 좌표까지 길찾아 이동한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                    "z": {"type": "integer"},
                },
                "required": ["x", "y", "z"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "goto_near",
            "description": "지정 좌표의 range 블록 이내까지만 이동한다(작업 대상에 접근). "
            "※range는 '도착 허용거리'야(탐색 범위 아님). 이미 그 거리 안이면 안 움직여. "
            "멀리 탐색하려면 range를 키우지 말고 '먼 좌표'를 goto해.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                    "z": {"type": "integer"},
                    "range": {"type": "integer", "description": "허용 거리(기본 2)"},
                },
                "required": ["x", "y", "z"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "look_at",
            "description": "절대 방향을 바라본다. yaw -180..180, pitch -90..90.",
            "parameters": {
                "type": "object",
                "properties": {"yaw": {"type": "number"}, "pitch": {"type": "number"}},
                "required": ["yaw", "pitch"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_slot",
            "description": "핫바 슬롯(0-8)을 든다.",
            "parameters": {
                "type": "object",
                "properties": {"slot": {"type": "integer", "minimum": 0, "maximum": 8}},
                "required": ["slot"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "attack",
            "description": "좌클릭 1회. 지금 바라보는(crosshair) 블록을 한 대 치거나, 생물을 때린다. "
            "블록을 부수려면 연타하거나 mine(on)/mine_block을 써.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "use",
            "description": "우클릭 1회. 지금 바라보는 면에 '든 블록'을 설치하거나(블록 놓기/건축), "
            "문·상자·제작대 등과 상호작용하거나, 든 음식/아이템을 사용한다. "
            "블록을 설치하려면: select_slot으로 그 블록을 손에 들고 → look_at으로 놓을 곳을 바라본 뒤 → use. "
            "(예: 흙 들고 발밑 보며 use 반복 = 흙 쌓아 위로 올라가기)",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mine",
            "description": "좌클릭 홀드(연속 채굴) 켜기/끄기. (특정 블록 채굴은 mine_block이 더 정확)",
            "parameters": {
                "type": "object",
                "properties": {"on": {"type": "boolean"}},
                "required": ["on"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mine_block",
            "description": "지정한 좌표의 블록 하나를 정확히 조준해서 끝까지 캔다(가장 신뢰성 있는 채집 — 통나무/광석 등). "
            "관찰의 '가까운 주요블록' 좌표를 그대로 넣어. 사거리 안(약 4블록)이어야 함. "
            "다 캐면 관찰의 mineTarget이 사라져. 너무 멀면 먼저 goto_near로 접근.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                    "z": {"type": "integer"},
                },
                "required": ["x", "y", "z"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "use_block",
            "description": "지정한 좌표의 블록을 정확히 조준해 우클릭한다(상호작용). 침대에서 자기(밤+근처 몹 없을 때 "
            "→ 리스폰 지점도 지정됨), 문/상자/제작대 열기 등에 사용. 관찰의 블록 좌표를 그대로 넣어. "
            "사거리 안(약 3~4블록)이어야 하니 멀면 먼저 goto_near로 접근. (그냥 use는 크로스헤어 조준이라 부정확 — "
            "특정 블록 상호작용은 use_block이 정확)",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                    "z": {"type": "integer"},
                },
                "required": ["x", "y", "z"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "follow",
            "description": "Baritone로 엔티티를 따라간다. entity_id 생략시 주변 플레이어.",
            "parameters": {
                "type": "object",
                "properties": {"entity_id": {"type": "integer"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel",
            "description": "진행 중인 Baritone 길찾기/따라가기를 멈춘다.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "swim_up",
            "description": "물에 빠졌을 때 수면 위로 헤엄쳐 올라온다(점프 홀드+위 보기로 잠깐 상승, 머리 위가 막혔으면 깨면서). "
            "관찰에 ⚠️숨 경고가 뜨면(=물속) 즉시 이걸 불러. 익사로 죽으면 가진 걸 다 잃으니 물 보이면 최우선.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "craft",
            "description": "아이템을 제작한다. 통나무→판자→막대→제작대/횃불은 그냥 호출 가능(인벤토리 2x2). "
            "곡괭이·도끼·검 같은 3x3 레시피는 먼저 제작대를 설치하고 그 제작대를 바라보며 use로 연 뒤 호출해야 함. "
            "재료가 인벤토리에 있어야 함.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item": {
                        "type": "string",
                        "description": "만들 아이템 id (예: planks, stick, crafting_table, torch, wooden_pickaxe)",
                    },
                    "count": {"type": "integer", "description": "제작 횟수(기본 1)"},
                },
                "required": ["item"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "drop",
            "description": "아이템을 바닥에 버려서 가방 칸을 비운다(가방이 꽉 차면 새 걸 못 만드니 쓸모없는 막대·흙·여분을 버려). "
            "item을 주면 그 아이템의 '모든 스택'을 버린다(예: stick → 막대 전부). "
            "item 없이 부르면 지금 손에 든(선택 슬롯) 스택 하나를 버린다. 관찰의 인벤토리에 있는 id를 그대로 써.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item": {
                        "type": "string",
                        "description": "버릴 아이템 id (예: stick, dirt, birch_sapling). 생략시 든 것 버림",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "store",
            "description": "상자(chest)에 아이템을 보관한다(버리지 말고 모아둬!). 상자 좌표 x,y,z를 주면 그 상자로 다가가 자동으로 열고 보관한다. "
            "item을 주면 그 아이템의 모든 스택을 넣고, 생략하면 가방 전체를 넣는다(곡괭이·도끼·검 등 도구는 자동으로 안 넣고 남겨둠). "
            "상자가 없으면 먼저 craft로 chest(판자 8개)를 만들어 use로 바닥에 설치한 뒤 그 좌표로 store해. "
            "흙·자갈 같은 진짜 쓰레기만 drop으로 버리고, 통나무·판자·식량·씨앗 등 쓸만한 건 전부 상자에 store해서 모아둬.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item": {
                        "type": "string",
                        "description": "보관할 아이템 id (생략시 가방 전체)",
                    },
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                    "z": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "take",
            "description": "상자나 화로에서 아이템을 꺼낸다(store의 반대). 좌표 x,y,z를 주면 그 상자/화로로 다가가 열고 꺼낸다. "
            "item을 주면 그 아이템만, 생략하면 안에 있는 걸 다 꺼낸다. "
            "특히 화로(furnace)에서 다 구워진 철괴(iron_ingot)를 꺼낼 때 꼭 필요해.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item": {
                        "type": "string",
                        "description": "꺼낼 아이템 id (생략시 전부)",
                    },
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                    "z": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "equip",
            "description": "지정한 아이템을 손에 든다(핫바로 옮겨 선택). select_slot은 핫바(0-8)만 되는데, "
            "가방 안쪽(메인 인벤)에 있는 제작대·도구·음식 등을 들고 싶을 때 써. "
            "예: 제작대를 바닥에 놓으려면 equip(crafting_table) 후 바닥 보고 use.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item": {
                        "type": "string",
                        "description": "손에 들 아이템 id (예: crafting_table, stone_pickaxe, bread)",
                    }
                },
                "required": ["item"],
            },
        },
    },
    # NOTE: 말로 하는 대답(인사/잡담 응답)은 Actor가 하지 않는다 — 병렬 Responder 스레드 담당.
    # Actor는 '행동이 필요한 요청'에만 행동(goto/follow/mine 등)으로 응한다.
]

META_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "consult_planner",
            "description": "막히거나 큰 결정이 필요할 때, 잠깐 멈춰 생각을 정리하도록 사색가(Planner)를 부른다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string", "description": "왜 생각이 필요한지"}
                },
                "required": ["reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "report_goal",
            "description": "지금 목표를 끝냈거나(done) 가망이 없을 때(failed) 알린다. 그러면 사색가가 다음 목표를 정해준다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["done", "failed"]},
                    "note": {"type": "string"},
                },
                "required": ["status", "note"],
            },
        },
    },
]

ACTOR_TOOLS = ACTION_TOOLS + META_TOOLS

TOOL_TO_CMD = {
    "goto": lambda a: {"type": "goto", "x": a["x"], "y": a["y"], "z": a["z"]},
    "goto_near": lambda a: {
        "type": "goto_near",
        "x": a["x"],
        "y": a["y"],
        "z": a["z"],
        **({"range": a["range"]} if "range" in a else {}),
    },
    "look_at": lambda a: {"type": "look", "yaw": a["yaw"], "pitch": a["pitch"]},
    "select_slot": lambda a: {"type": "select_slot", "slot": a["slot"]},
    "attack": lambda a: {"type": "attack"},
    "use": lambda a: {"type": "use"},
    "mine": lambda a: {"type": "mine", "on": a["on"]},
    "mine_block": lambda a: {
        "type": "mine_block",
        "x": a["x"],
        "y": a["y"],
        "z": a["z"],
    },
    "use_block": lambda a: {"type": "use_block", "x": a["x"], "y": a["y"], "z": a["z"]},
    "follow": lambda a: {
        "type": "follow",
        **({"entityId": a["entity_id"]} if "entity_id" in a else {}),
    },
    "cancel": lambda a: {"type": "cancel"},
    "chat": lambda a: {"type": "chat", "message": a["message"]},
    "craft": lambda a: {
        "type": "craft",
        "item": a["item"],
        **({"count": a["count"]} if "count" in a else {}),
    },
    "drop": lambda a: {
        "type": "drop",
        **({"item": a["item"]} if a.get("item") else {}),
    },
    "equip": lambda a: {"type": "equip", "item": a["item"]},
}

UPDATE_MEMORY_TOOL = {
    "type": "function",
    "function": {
        "name": "update_memory",
        "description": "반성 결과를 메모리에 반영한다. 배운 교훈과 갱신된 목표/기분을 담아 호출.",
        "parameters": {
            "type": "object",
            "properties": {
                "lessons": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "새로 배운 교훈(0~3개, whoami_rwl 말투, 행동에 쓸모있게)",
                },
                "long_term": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "장기 목표(전체 목록으로)",
                },
                "short_term": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "단기 목표(전체 목록으로)",
                },
                "mood": {"type": "string", "description": "지금 기분"},
            },
        },
    },
}

SET_LESSONS_TOOL = {
    "type": "function",
    "function": {
        "name": "set_lessons",
        "description": "중복·유사 교훈을 합치고 쓸모없는 걸 빼서, 정리된 교훈 목록으로 통째 교체한다.",
        "parameters": {
            "type": "object",
            "properties": {
                "lessons": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "정리된 교훈 목록. 서로 다른(겹치지 않는) 교훈은 개수 상관없이 모두 남기고, "
                    "중복·유사한 것만 합쳐. 억지로 개수를 맞추지 마. 구체적·행동지향, whoami_rwl 말투.",
                }
            },
            "required": ["lessons"],
        },
    },
}

RESPOND_TOOL = {
    "type": "function",
    "function": {
        "name": "respond",
        "description": (
            "인게임 채팅 중 너(whoami_rwl)에게 하는 말이나 너와의 대화가 있으면 "
            "이 도구로 답한다. 자기들끼리의 잡담이거나 너와 무관하면 이 도구를 "
            "호출하지 마라(침묵). 답변과는 별개로, 이 대화에서 앞으로 도움될 지식·"
            "조언·약속을 배웠으면 remember에 적어 교훈으로 남길 수 있다."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "인게임 채팅으로 보낼 답(whoami_rwl 말투, 한국어). 보통 1~2문장.",
                },
                "remember": {
                    "type": "string",
                    "description": (
                        "이 대화에서 앞으로 플레이에 도움될 교훈·지식·약속을 "
                        "배웠으면 한 줄로 적어(나중에 행동에 쓸 수 있게 구체적으로). "
                        "딱히 새로 기억할 게 없으면 비워둬(빈 문자열)."
                    ),
                },
            },
            "required": ["message"],
        },
    },
}
