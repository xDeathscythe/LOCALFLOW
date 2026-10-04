"""Exercise cancellation during inference and playback without playing audio."""
import io
import json
import os
import queue
import sys
import tempfile
import threading
import time
import types
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
playing = threading.Event()
stopped = threading.Event()
calls = []


def play(path, flags):
    calls.append(path)
    (playing if path else stopped).set()


sys.modules["winsound"] = types.SimpleNamespace(PlaySound=play, SND_FILENAME=1, SND_ASYNC=2)
from voice_output_session import serve, prune_outputs


class Input:
    def __init__(self):
        self.queue = queue.Queue()

    def __iter__(self):
        while (line := self.queue.get()) is not None:
            yield line

    def send(self, **request):
        self.queue.put(json.dumps(request))


class Output(io.StringIO):
    def __init__(self):
        super().__init__()
        self.messages = queue.Queue()
        self.partial = ""

    def write(self, value):
        self.partial += value
        while "\n" in self.partial:
            line, self.partial = self.partial.split("\n", 1)
            self.messages.put(json.loads(line))
        return len(value)


class Engine:
    def __init__(self):
        self.entered, self.resume = threading.Event(), threading.Event()

    def synthesize(self, text, output, cancelled=None):
        if text == "held":
            self.entered.set()
            assert self.resume.wait(3)
        with wave.open(str(output), "wb") as wav:
            wav.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            wav.writeframes(b"\0\0" * 8000 * 5)


incoming, outgoing, engine = Input(), Output(), Engine()
saved_in, saved_out = sys.stdin, sys.stdout
directory = Path(tempfile.mkdtemp(prefix="localflow-voice-session-"))
sys.stdin, sys.stdout = incoming, outgoing
thread = threading.Thread(target=serve, args=(engine, "fixture", directory))
try:
    thread.start()
    assert outgoing.messages.get(timeout=3)["type"] == "ready"
    incoming.send(id="first", type="speak", text="held")
    assert engine.entered.wait(3)
    incoming.send(id="first", type="cancel")
    time.sleep(0.05)
    engine.resume.set()
    result = outgoing.messages.get(timeout=3)
    assert result["id"] == "first" and not result["success"]
    assert not calls and not list(directory.glob("*.wav")), "cancelled inference never plays or retains output"
    incoming.send(id="second", type="speak", text="日本語 العربية")
    assert playing.wait(3)
    started = time.monotonic()
    incoming.send(id="second", type="cancel")
    assert stopped.wait(1)
    assert time.monotonic() - started < 1, "playback cancellation does not wait for full audio duration"
    assert not outgoing.messages.get(timeout=3)["success"]
    incoming.send(id="third", type="speak", text="Recovery", play=False)
    result = outgoing.messages.get(timeout=3)
    assert result["success"] and Path(result["wav"]).exists()
finally:
    incoming.queue.put(None)
    engine.resume.set()
    thread.join(5)
    sys.stdin, sys.stdout = saved_in, saved_out
assert not thread.is_alive()
for index in range(5):
    output = directory / f'piper-{index:032x}.wav'
    output.write_bytes(b'generated')
    os.utime(output, (time.time() - 100 + index, time.time() - 100 + index))
reference = directory / 'reference.wav'; reference.write_bytes(b'owner audio')
export = directory / 'exported-speech.wav'; export.write_bytes(b'owner export')
prune_outputs(directory, keep=2)
assert len(list(directory.glob('piper-*.wav'))) == 2
assert reference.exists() and export.exists()
protected = directory / f'piper-{4:032x}.wav'
prune_outputs(directory, max_age=0, protected=protected)
assert list(directory.glob('piper-*.wav')) == [protected]
print("VOICE_SESSION_OK: inference cancellation, immediate playback stop, reuse, serial execution, bounded temporary outputs and protected user audio")
