"""Cli."""

from __future__ import annotations

import argparse
from pathlib import Path

from .actor import run_actor
from .runtime_options import AgentOptions, ModelEndpoint


def main():
    ap = argparse.ArgumentParser(description="Minecraft LLM agent")
    ap.add_argument("--bot-host", default="127.0.0.1")
    ap.add_argument(
        "--bot-port", type=int, default=25599, help="mcagent mod control server port"
    )
    ap.add_argument(
        "--server-host", default="127.0.0.1", help="MC server the bot joins"
    )
    ap.add_argument("--server-port", type=int, default=25566)
    ap.add_argument("--max-calls", type=int, default=200, help="0 = 무제한(무한 실행)")
    ap.add_argument("--max-tokens", type=int, default=500_000, help="0 = 무제한")
    ap.add_argument("--loop-delay", type=float, default=2.0)
    ap.add_argument("--actor-url", default="http://127.0.0.1:8002/v1")
    ap.add_argument("--actor-model", default="actor")
    ap.add_argument("--planner-url", default="http://127.0.0.1:8001/v1")
    ap.add_argument("--planner-model", default="planner")
    ap.add_argument("--memory-dir", type=Path, default=Path.cwd() / "memory")
    args = ap.parse_args()
    cfg = AgentOptions(
        bot_host=args.bot_host,
        bot_port=args.bot_port,
        server_host=args.server_host,
        server_port=args.server_port,
        max_calls=args.max_calls,
        max_tokens=args.max_tokens,
        loop_delay=args.loop_delay,
        mem_dir=args.memory_dir,
        actor=ModelEndpoint(args.actor_url, args.actor_model, 30.0),
        planner=ModelEndpoint(args.planner_url, args.planner_model, 180.0),
    )
    run_actor(cfg)
