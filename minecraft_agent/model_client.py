"""Model client."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request

from .runtime_options import AgentOptions, ModelEndpoint


class UsageBudget:
    """Thread-safe call/token meter + hard caps (shared by Actor and Planner)."""

    def __init__(self, cfg: AgentOptions):
        self.cfg = cfg
        self._lock = threading.Lock()
        self.calls = 0
        self.tokens = 0

    def record(self, usage: dict | None, dt: float, who: str):
        ct = (usage or {}).get("completion_tokens", 0)
        tt = (usage or {}).get("total_tokens", 0)
        with self._lock:
            self.calls += 1
            self.tokens += tt
            c, t = self.calls, self.tokens
        print(
            f"[meter] {who}: {dt:.1f}s, +{ct} out / {tt} tok | total {c} calls, {t} tok"
        )

    def over_cap(self) -> str | None:
        with self._lock:
            # max_calls/max_tokens <= 0 means "no limit" (run forever).
            if self.cfg.max_calls > 0 and self.calls >= self.cfg.max_calls:
                return f"call cap {self.cfg.max_calls} reached"
            if self.cfg.max_tokens > 0 and self.tokens >= self.cfg.max_tokens:
                return f"token cap {self.cfg.max_tokens} reached"
        return None


class ChatCompletionClient:
    def __init__(self, conf: ModelEndpoint, meter: UsageBudget):
        self.conf = conf
        self.meter = meter

    def chat(
        self, messages, tools=None, enable_thinking=False, tool_choice="auto"
    ) -> dict:
        body = {
            "model": self.conf.model,
            "messages": messages,
            "chat_template_kwargs": {"enable_thinking": enable_thinking},
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = tool_choice
        data = json.dumps(body).encode()
        url = self.conf.base_url.rstrip("/") + "/chat/completions"
        t0 = time.monotonic()
        last_err = None
        for attempt in range(3):  # tolerate transient resets / cold-start
            req = urllib.request.Request(
                url, data=data, headers={"Content-Type": "application/json"}
            )
            try:
                with urllib.request.urlopen(req, timeout=self.conf.timeout) as resp:
                    out = json.loads(resp.read())
                dt = time.monotonic() - t0
                self.meter.record(out.get("usage"), dt, self.conf.model)
                return out["choices"][0]["message"]
            except (urllib.error.URLError, ConnectionError, OSError) as e:
                last_err = e
                print(f"[llm] {self.conf.model} attempt {attempt + 1} failed: {e}")
                time.sleep(1.0 * (attempt + 1))
        raise last_err
