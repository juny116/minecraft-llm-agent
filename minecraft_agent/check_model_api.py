#!/usr/bin/env python3
"""Check tool calling and generation throughput for a model endpoint."""

import json
import time
import urllib.request

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "move_to",
            "description": "Move the Minecraft bot to a block coordinate.",
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
    }
]


def request_completion(base_url, body):
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    r = json.load(urllib.request.urlopen(req, timeout=300))
    return time.time() - t0, r


def check_model(name, base_url):
    print(f"\n===== {name} ({base_url}) =====")
    # 1) function-calling test
    dt, r = request_completion(
        base_url,
        {
            "model": name,
            "messages": [
                {
                    "role": "system",
                    "content": "You control a Minecraft bot. Use tools when asked to act.",
                },
                {"role": "user", "content": "Walk to coordinates x=10, y=64, z=-5."},
            ],
            "tools": TOOLS,
            "tool_choice": "auto",
            "temperature": 0,
            "max_tokens": 512,
            "chat_template_kwargs": {"enable_thinking": False},
        },
    )
    msg = r["choices"][0]["message"]
    tc = msg.get("tool_calls")
    if tc:
        f = tc[0]["function"]
        print(f"[tool_calls] OK -> {f['name']}({f['arguments']})")
    else:
        print(f"[tool_calls] NONE. content={msg.get('content', '')[:200]!r}")
    # 2) decode tok/s (plain generation, thinking off)
    dt2, r2 = request_completion(
        base_url,
        {
            "model": name,
            "messages": [
                {
                    "role": "user",
                    "content": "Count from 1 to 200, comma separated, nothing else.",
                }
            ],
            "temperature": 0,
            "max_tokens": 400,
            "chat_template_kwargs": {"enable_thinking": False},
        },
    )
    u = r2["usage"]
    ct = u["completion_tokens"]
    print(
        f"[tok/s] {ct} completion tokens in {dt2:.2f}s -> {ct / dt2:.1f} tok/s  (prompt={u['prompt_tokens']})"
    )


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Check model tool calling and generation throughput"
    )
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    check_model(args.model, args.base_url)


if __name__ == "__main__":
    main()
