"""Runtime options."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ModelEndpoint:
    base_url: str
    model: str
    timeout: float


@dataclass
class AgentOptions:
    bot_host: str = "127.0.0.1"
    bot_port: int = 25599  # mcagent mod control server (0.5.0)
    # MC server the bot joins (headless client has no GUI to click "join"); the
    # controller drives connect/reconnect via the mod's "connect" command.
    server_host: str = "127.0.0.1"
    server_port: int = 25566
    # Separate model endpoints for action selection and planning.
    actor: ModelEndpoint = field(
        default_factory=lambda: ModelEndpoint(
            "http://127.0.0.1:8002/v1", "actor", timeout=30.0
        )
    )
    planner: ModelEndpoint = field(
        default_factory=lambda: ModelEndpoint(
            "http://127.0.0.1:8001/v1", "planner", timeout=180.0
        )
    )
    # Hard caps — the bot stops cleanly when any is hit (cost/runaway guard).
    max_calls: int = 200
    max_tokens: int = 500_000
    loop_delay: float = 2.0  # seconds between actor steps
    # Reflection backstop: force a plan if the Actor never escalates on its own.
    backstop_actions: int = 20
    backstop_seconds: float = 240.0
    mem_dir: Path = field(default_factory=lambda: Path.cwd() / "memory")
