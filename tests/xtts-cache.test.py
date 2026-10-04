"""Real CUDA XTTS cache verification; no playback or network downloads."""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import wave
from pathlib import Path
from concurrent.futures import CancelledError

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
import voice_output_worker as worker

directory = Path(tempfile.mkdtemp(prefix="localflow-xtts-cache-"))
reference = directory / "reference.wav"
shutil.copyfile(worker.XTTS_REFERENCE_AUDIO, reference)
worker.XTTS_REFERENCE_AUDIO = reference
worker.OUTPUT_DIR = directory / "output"
worker.OUTPUT_DIR.mkdir()
engine = worker.XttsEngine()
model = engine.tts.synthesizer.tts_model
conditioning = model.get_conditioning_latents
calls = 0


def counted(*args, **kwargs):
    global calls
    calls += 1
    return conditioning(*args, **kwargs)


model.get_conditioning_latents = counted
timings = []
for index in range(2):
    started = time.perf_counter()
    output = worker.OUTPUT_DIR / f"test-{index}.wav"
    engine.synthesize("The voice is ready. The model stays loaded.", output)
    with wave.open(str(output), "rb") as wav:
        assert wav.getnframes() > 0
    timings.append(round(time.perf_counter() - started, 3))
    assert calls == 1, "sentences and subsequent requests reuse the native conditioning cache"
with wave.open(str(reference), "rb") as wav:
    params, frames = wav.getparams(), bytearray(wav.readframes(wav.getnframes()))
frames[0] ^= 1
with wave.open(str(reference), "wb") as wav:
    wav.setparams(params)
    wav.writeframes(frames)
engine.synthesize("Reference changed.", worker.OUTPUT_DIR / "changed.wav")
assert calls == 2 and len(list(engine.voice_dir.glob("*.pth"))) == 2
cancelled = threading.Event()
timer = threading.Timer(0.2, cancelled.set)
started = time.perf_counter()
timer.start()
try:
    engine.synthesize("The model should stop between generation steps. " * 20, worker.OUTPUT_DIR / "cancelled.wav", cancelled)
    raise AssertionError("Long synthesis must stop at a decoding step")
except CancelledError:
    cancel_elapsed = time.perf_counter() - started
    assert cancel_elapsed < 5, cancel_elapsed
finally:
    timer.cancel()
engine.synthesize("The same model recovered.", worker.OUTPUT_DIR / "recovered.wav")
assert not model.gpt.gpt_inference._forward_pre_hooks
assert calls == 2
print("XTTS_NATIVE_CACHE_OK", json.dumps({"conditioningCalls": calls, "firstAndWarmSeconds": timings, "cancelSeconds": round(cancel_elapsed,3), "directory": str(directory)}))
