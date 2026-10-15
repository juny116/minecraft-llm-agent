#!/usr/bin/env python3
"""whoami_rwl 봇 실시간 대시보드.

봇의 행동/생각(로그) + 교훈 + 목표/기분 + 현재 상태(인벤·체력·시간)를
브라우저에서 자동갱신으로 본다. 의존성 0 (stdlib만).

    python3 -m minecraft_agent.status_dashboard            # http://localhost:8899
"""

import json
import re
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8899
BOT = ("127.0.0.1", 25599)  # mcagent mod control server (0.6.0)
LOG = Path("logs/agent.log")
MEM = Path.cwd() / "memory"

# Package defaults and prompts; live observations are read separately.
try:
    from . import prompts as _ag
    from .action_tools import ACTOR_TOOLS
    from .runtime_options import AgentOptions

    _cfg = AgentOptions()
    STATIC = {
        "persona": _ag.PERSONA,
        "guide": _ag.ACTOR_GUIDE,
        "planner_role": _ag.PLANNER_SYSTEM.replace(_ag.PERSONA, "").strip(),
        "config": {
            "Actor 기본 모델": f"{_cfg.actor.model} @ {_cfg.actor.base_url}",
            "Planner 기본 모델": f"{_cfg.planner.model} @ {_cfg.planner.base_url}",
            "기본 행동 주기": f"{_cfg.loop_delay}초",
            "기본 반성 백스톱": f"{_cfg.backstop_actions}행동 또는 {_cfg.backstop_seconds:.0f}초마다",
            "기본 봇 포트": f"{_cfg.bot_host}:{_cfg.bot_port}",
        },
        "tools": [
            (t["function"]["name"], t["function"].get("description", ""))
            for t in ACTOR_TOOLS
        ],
    }
except Exception as e:
    STATIC = {
        "persona": f"(프롬프트 로드 실패: {e})",
        "guide": "",
        "planner_role": "",
        "config": {},
        "tools": [],
    }

# 로그에서 '행동/생각'으로 보여줄 라인 패턴
FEED_PAT = re.compile(
    r"\[act\]|\[actor\]|\[planner\]|\[respawn\]|\[chat\]|"
    r"블록 깨짐|드롭|채굴|반성|통합|채집|포기"
)


def bot_state():
    try:
        s = socket.create_connection(BOT, timeout=3)
        f = s.makefile("rw", encoding="utf-8", newline="\n")
        f.write(json.dumps({"type": "state"}) + "\n")
        f.flush()
        st = json.loads(f.readline())
        s.close()
        return st
    except Exception:
        return {}


def feed(n=60):
    if not LOG.exists():
        return []
    lines = LOG.read_text(encoding="utf-8", errors="replace").splitlines()
    out = [ln for ln in lines if FEED_PAT.search(ln)]
    return out[-n:]


def read_lessons():
    p = MEM / "lessons.md"
    if not p.exists():
        return []
    return [
        ln.lstrip("- ").strip()
        for ln in p.read_text(encoding="utf-8").splitlines()
        if ln.strip()
    ]


def read_goals():
    p = MEM / "goals.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def journal_tail(n=15):
    p = MEM / "journal.md"
    if not p.exists():
        return []
    return p.read_text(encoding="utf-8").splitlines()[-n:]


def build_data():
    st = bot_state()
    inv = [
        f"{i.get('item', '').split(':')[-1]} x{i.get('count')}"
        for i in st.get("inventory", [])
        if i.get("item")
    ]
    t = st.get("timeOfDay")
    phase = ""
    if t is not None:
        if t < 2000:
            phase = "아침"
        elif t < 9000:
            phase = "낮 ☀️"
        elif t < 12800:
            phase = "오후→해질녘"
        elif t < 13500:
            phase = "밤 시작 🌆"
        elif t < 22000:
            phase = "한밤 🌙"
        else:
            phase = "새벽 🌄"
    p = st.get("pos") or {}
    g = read_goals()
    return {
        "connected": bool(st.get("ready")),
        "hp": st.get("health"),
        "maxhp": st.get("maxHealth"),
        "food": st.get("food"),
        "time": t,
        "phase": phase,
        "isNight": st.get("isNight"),
        "day": st.get("dayCount"),
        "pos": [
            round(p.get("x", 0), 1),
            round(p.get("y", 0), 1),
            round(p.get("z", 0), 1),
        ]
        if p
        else None,
        "inventory": inv,
        "held": (st.get("heldItem") or {}).get("item"),
        "goals_long": g.get("long_term", []),
        "goals_short": g.get("short_term", []),
        "mood": g.get("mood", ""),
        "lessons": read_lessons(),
        "feed": feed(),
        "journal": journal_tail(),
        "static": STATIC,
    }


PAGE = """<!doctype html><html lang=ko><head><meta charset=utf-8>
<title>whoami_rwl 실시간</title>
<style>
*{box-sizing:border-box} body{margin:0;background:#0d1117;color:#c9d1d9;
font-family:'Segoe UI',-apple-system,sans-serif;font-size:14px}
header{background:#161b22;padding:10px 16px;border-bottom:1px solid #30363d;
display:flex;gap:18px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:5}
header b{color:#58a6ff} .pill{background:#21262d;border-radius:12px;padding:3px 10px;font-size:13px}
.night{color:#a371f7} .day{color:#e3b341} .dead{color:#f85149}
.wrap{display:grid;grid-template-columns:1.3fr 1fr;gap:14px;padding:14px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;margin-bottom:14px}
.card h3{margin:0 0 8px;font-size:13px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
#feed div{padding:3px 0;border-bottom:1px solid #21262d;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;word-break:break-all}
.f-think{color:#79c0ff} .f-act{color:#7ee787} .f-plan{color:#d2a8ff} .f-death{color:#f85149} .f-chat{color:#ffa657}
#inv span{display:inline-block;background:#21262d;border-radius:6px;padding:2px 8px;margin:2px;font-size:13px}
#lessons li{margin:5px 0;line-height:1.4} .mood{font-style:italic;color:#e3b341;margin-top:6px}
.g{margin:3px 0} .g b{color:#58a6ff}
.dim{color:#6e7681;font-size:12px}
.pre{white-space:pre-wrap;background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:8px;font-family:Consolas,monospace;font-size:13px;color:#adbac7;margin:6px 0;line-height:1.45}
details{margin:6px 0} summary{padding:4px 0}
</style></head><body>
<header>
 <b>🤖 whoami_rwl</b>
 <span class=pill id=conn>연결?</span>
 <span class=pill id=hp>HP</span>
 <span class=pill id=time>시간</span>
 <span class=pill id=pos>위치</span>
 <span class=pill id=held>든것</span>
 <span class=dim id=upd></span>
</header>
<div class=wrap>
 <div>
  <div class=card><h3>🧠 실시간 행동 · 생각 (최신↓)</h3><div id=feed></div></div>
 </div>
 <div>
  <div class=card><h3>🎒 인벤토리</h3><div id=inv></div></div>
  <div class=card><h3>🎯 목표 · 기분</h3><div id=goals></div></div>
  <div class=card><h3>📖 배운 교훈 (<span id=lcount>0</span>)</h3><ul id=lessons></ul></div>
 </div>
</div>
<div style="padding:0 14px 24px">
 <div class=card><h3>⚙️ 설정 · 페르소나 · 도구 (고정값)</h3>
  <details open><summary style="cursor:pointer;color:#58a6ff">🎭 페르소나</summary><pre id=persona class=pre></pre></details>
  <details><summary style="cursor:pointer;color:#58a6ff">📋 행동 가이드(시스템)</summary><pre id=guide class=pre></pre></details>
  <details><summary style="cursor:pointer;color:#58a6ff">🛠️ Planner 역할</summary><pre id=planner class=pre></pre></details>
  <details open><summary style="cursor:pointer;color:#58a6ff">🔧 기본 설정</summary><div id=config></div></details>
  <details><summary style="cursor:pointer;color:#58a6ff">🧰 사용 가능한 도구 (<span id=tcount>0</span>)</summary><div id=tools></div></details>
 </div>
</div>
<script>
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function cls(l){if(l.includes('관망'))return 'f-think';if(l.includes('[planner]')||l.includes('반성')||l.includes('통합'))return 'f-plan';
 if(l.includes('respawn')||l.includes('죽'))return 'f-death';if(l.includes('[chat]'))return 'f-chat';return 'f-act'}
async function tick(){
 try{
  const d=await (await fetch('/data',{cache:'no-store'})).json();
  document.getElementById('conn').textContent=d.connected?'🟢 인게임':'🔴 연결끊김';
  document.getElementById('conn').className='pill '+(d.connected?'':'dead');
  document.getElementById('hp').textContent='❤️ '+(d.hp!=null?d.hp.toFixed(1):'?')+'/'+(d.maxhp||20)+'  🍖'+(d.food??'?');
  document.getElementById('hp').className='pill '+(d.hp!=null&&d.hp<6?'dead':'');
  document.getElementById('time').textContent='🕐 '+(d.time??'?')+' '+(d.phase||'');
  document.getElementById('time').className='pill '+(d.isNight?'night':'day');
  document.getElementById('pos').textContent=d.pos?('📍 '+d.pos.join(', ')):'📍 ?';
  document.getElementById('held').textContent='✋ '+(d.held?d.held.split(':').pop():'빈손');
  document.getElementById('upd').textContent='갱신 '+new Date().toLocaleTimeString();
  const f=document.getElementById('feed');
  f.innerHTML=d.feed.map(l=>`<div class="${cls(l)}">${esc(l)}</div>`).join('');
  f.scrollTop=f.scrollHeight;
  document.getElementById('inv').innerHTML=d.inventory.length?d.inventory.map(i=>`<span>${esc(i)}</span>`).join(''):'<span class=dim>빈손</span>';
  let gh='';d.goals_long.forEach(x=>gh+=`<div class=g><b>장기</b> ${esc(x)}</div>`);
  d.goals_short.forEach(x=>gh+=`<div class=g><b>단기</b> ${esc(x)}</div>`);
  if(d.mood)gh+=`<div class=mood>"${esc(d.mood)}"</div>`;
  document.getElementById('goals').innerHTML=gh;
  document.getElementById('lcount').textContent=d.lessons.length;
  document.getElementById('lessons').innerHTML=d.lessons.map(l=>`<li>${esc(l)}</li>`).join('');
  if(!window._sdone&&d.static){window._sdone=true;const s=d.static;
   document.getElementById('persona').textContent=s.persona;
   document.getElementById('guide').textContent=s.guide;
   document.getElementById('planner').textContent=s.planner_role;
   let ch='';for(const k in s.config)ch+=`<div class=g><b>${esc(k)}</b> ${esc(s.config[k])}</div>`;
   document.getElementById('config').innerHTML=ch;
   document.getElementById('tcount').textContent=s.tools.length;
   document.getElementById('tools').innerHTML=s.tools.map(t=>`<div class=g><b>${esc(t[0])}</b> <span class=dim>${esc(t[1])}</span></div>`).join('');
  }
 }catch(e){document.getElementById('conn').textContent='⚠️ 서버오류'}
}
tick();setInterval(tick,2500);
</script></body></html>"""


class DashboardHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/data"):
            body = json.dumps(build_data()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


def main():
    global PORT, BOT, LOG, MEM
    import argparse

    parser = argparse.ArgumentParser(
        description="View Minecraft agent status and memory"
    )
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--bot-host", default=BOT[0])
    parser.add_argument("--bot-port", type=int, default=BOT[1])
    parser.add_argument("--log-file", type=Path, default=LOG)
    parser.add_argument("--memory-dir", type=Path, default=MEM)
    args = parser.parse_args()
    PORT, BOT, LOG, MEM = (
        args.port,
        (args.bot_host, args.bot_port),
        args.log_file,
        args.memory_dir,
    )
    print(f"대시보드: http://localhost:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), DashboardHandler).serve_forever()


if __name__ == "__main__":
    main()
