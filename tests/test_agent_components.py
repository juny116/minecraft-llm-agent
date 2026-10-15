import importlib
import io
import json
import pkgutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import minecraft_agent
from minecraft_agent.file_memory import FileMemory
from minecraft_agent.game_client import GameClient
from minecraft_agent.model_client import ChatCompletionClient, UsageBudget
from minecraft_agent.observations import new_user_chats, notable_blocks
from minecraft_agent.runtime_options import AgentOptions, ModelEndpoint


class AgentTests(unittest.TestCase):
    def test_imports_do_not_start_connections(self):
        with (
            patch(
                "socket.create_connection",
                side_effect=AssertionError("network at import"),
            ),
            patch(
                "urllib.request.urlopen", side_effect=AssertionError("model at import")
            ),
        ):
            for entry in pkgutil.iter_modules(minecraft_agent.__path__):
                importlib.import_module("minecraft_agent." + entry.name)

    @patch("minecraft_agent.game_client.socket.create_connection")
    def test_game_protocol(self, connect):
        stream = Mock()
        stream.readline.return_value = '{"ready":true}\n'
        connect.return_value.makefile.return_value = stream
        client = GameClient("localhost", 1234)
        self.assertEqual(client.state(), {"ready": True})
        self.assertEqual(json.loads(stream.write.call_args.args[0]), {"type": "state"})
        client.connect_world("game", 25565)
        self.assertEqual(
            json.loads(stream.write.call_args.args[0]),
            {"type": "connect", "host": "game", "port": 25565},
        )
        stream.readline.return_value = ""
        with self.assertRaises(ConnectionError):
            client.state()

    @patch("minecraft_agent.model_client.urllib.request.urlopen")
    def test_model_request_and_budget(self, urlopen):
        response = {
            "choices": [{"message": {"role": "assistant", "content": "hello"}}],
            "usage": {"total_tokens": 12, "completion_tokens": 2},
        }
        urlopen.return_value.__enter__.return_value = io.BytesIO(
            json.dumps(response).encode()
        )
        budget = UsageBudget(AgentOptions(max_calls=1))
        client = ChatCompletionClient(
            ModelEndpoint("http://localhost/v1/", "test-model", 5), budget
        )
        self.assertEqual(
            client.chat([{"role": "user", "content": "hi"}])["content"], "hello"
        )
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "http://localhost/v1/chat/completions")
        self.assertEqual(json.loads(request.data)["model"], "test-model")
        self.assertEqual(budget.tokens, 12)
        self.assertIsNotNone(budget.over_cap())

    def test_memory_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            memory = FileMemory(Path(folder))
            memory.apply_plan(
                {"short_term": ["collect wood"], "lessons": ["remember a tree"]}
            )
            memory.remember_places([(1, "oak_log", 1, 64, 0)])
            memory.record_event("found tree")
            loaded = FileMemory(Path(folder))
            self.assertEqual(loaded.load_goals()["short_term"], ["collect wood"])
            recalled = loaded.recall({"pos": {"x": 0, "y": 64, "z": 0}})
            for text in ("remember a tree", "oak_log(1,64,0)", "found tree"):
                self.assertIn(text, recalled)

    def test_chat_cursor_filters_bot_and_backlog(self):
        state = {"recentChat": ["<player> old"]}
        self.assertEqual(new_user_chats(state, None, "bot"), ([], "<player> old"))
        state["recentChat"] += ["<bot> own", "<player> new", "joined world"]
        messages, marker = new_user_chats(state, "<player> old", "bot")
        self.assertEqual(messages, ["<player> new"])
        self.assertEqual(marker, "joined world")

    def test_notable_blocks_skip_terrain_and_sort_distance(self):
        state = {
            "pos": {"x": 0, "y": 0, "z": 0},
            "nearbyBlocks": [
                {"block": "minecraft:stone", "x": 0, "y": 0, "z": 0},
                {"block": "minecraft:chest", "x": 3, "y": 0, "z": 0},
                {"block": "minecraft:oak_log", "x": 1, "y": 0, "z": 0},
            ],
        }
        self.assertEqual(
            [item[1] for item in notable_blocks(state)], ["oak_log", "chest"]
        )


if __name__ == "__main__":
    unittest.main()
