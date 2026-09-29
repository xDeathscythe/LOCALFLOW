from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from codex_cleanup import parse_final_message  # noqa: E402
from worker import build_polish_prompt, normalize_transcript_text, output_language_for  # noqa: E402
import worker


result = {"action": "dictate", "target_language": None, "text": "Corrected text."}
event = {"type": "item.completed", "item": {"type": "agent_message", "text": json.dumps(result)}}
assert parse_final_message(json.dumps(event)) == result

prompt = build_polish_prompt("broken transcript", {"cleanupLevel": "high"}, "auto", "original language")
assert "sound-level and word-boundary changes" in prompt
assert "entire transcript as evidence" in prompt
assert "Ollama" not in prompt
assert "Qwen" not in prompt
assert normalize_transcript_text("Здраво", "sr", "sr") == "Zdravo"
assert normalize_transcript_text("Привет", "auto", "ru") == "Привет"
assert output_language_for("en") == "English"
assert output_language_for("auto") == "Original language"
assert output_language_for("auto", "de") == "the detected original language (de)"

# Exercise the full handler: cleanup disabled must never launch a Codex process.
transcript = {"text": "こんにちは Здраво مرحبا", "language": "auto", "duration": 1, "segments": []}
with patch.object(worker, "transcribe_audio", return_value=transcript), \
     patch.object(worker, "emit") as emit, \
     patch("codex_cleanup.subprocess.run", side_effect=AssertionError("Cleanup launched a process")):
    for options in ({"cleanupLevel": "none", "cleanup": False}, {"cleanup": False}):
        worker.handle_transcribe({"id": "disabled", "params": {"path": "test.wav", "options": options}})
        result = emit.call_args.args[0]
        assert result["ok"] and result["data"]["rawText"] == transcript["text"]
        assert result["data"]["polishedText"] == ""

print("codex cleanup contract ok")
