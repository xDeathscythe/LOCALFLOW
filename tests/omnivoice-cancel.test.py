"""Real offline OmniVoice cancellation and reuse; never plays audio."""
import json
import os
import sys
import tempfile
import threading
import time
import wave
from concurrent.futures import CancelledError
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from voice_output_worker import OmniVoiceEngine

directory = Path(tempfile.mkdtemp(prefix='localflow-omni-cancel-'))
engine = OmniVoiceEngine()
cancelled = threading.Event()
calls = 0


def cancel_second_step(*_):
    global calls
    calls += 1
    if calls == 2:
        cancelled.set()


handle = engine.model.llm.register_forward_pre_hook(cancel_second_step)
started = time.perf_counter()
try:
    engine.synthesize('Ovaj glas treba da se prekine tokom računanja i zatim ponovo radi.', directory / 'cancelled.wav', cancelled)
    raise AssertionError('Expected cooperative cancellation during inference')
except CancelledError:
    elapsed = time.perf_counter() - started
finally:
    handle.remove()
assert calls == 2 and not engine.model.llm._forward_pre_hooks
engine.synthesize('Glas ponovo radi.', directory / 'recovered.wav')
with wave.open(str(directory / 'recovered.wav'), 'rb') as wav:
    assert wav.getnframes() > 0
print('OMNIVOICE_CANCEL_REUSE_OK', json.dumps({'forwardCalls': calls, 'cancelSeconds': round(elapsed, 3), 'directory': str(directory)}))
