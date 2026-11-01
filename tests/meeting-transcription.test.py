"""Meeting ASR keeps its own language and never enters dictation cleanup context."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import worker

os.environ["LOCALFLOW_WHISPER_LANGUAGE"] = "sr"
calls = []
events = []
worker.transcribe_audio = lambda request, path, language=None: calls.append((request, path, language)) or {
    "text": "日本語 العربية", "language": "ja", "duration": 1,
    "segments": [{"start": 0, "end": 1, "text": "日本語 العربية"}],
}
worker.polish_transcript = lambda *_args: (_ for _ in ()).throw(AssertionError("Meeting reached dictation cleanup"))
worker.emit = events.append
worker.handle_transcribe({"id": "meeting", "params": {"path": "fixture.wav", "options": {"transcriptOnly": True}}})
assert calls == [("meeting", "fixture.wav", "auto")]
assert events[-1]["data"]["rawText"] == "日本語 العربية"
assert events[-1]["data"]["polishedText"] == ""
assert worker.configured_language() == "sr", "A meeting must not change the user's dictation language"
print("MEETING_ASR_ISOLATION_OK: auto language, raw Unicode, no cleanup/context mutation")
