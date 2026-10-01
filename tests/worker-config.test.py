import contextlib
import io
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import worker

assert not {"faster_whisper", "numpy", "av"}.intersection(sys.modules), "Configuration must not load inference libraries"
assert worker.resolve_device() == 'cpu', 'Fresh installs must work without NVIDIA hardware'
assert worker.resolve_compute_type() == 'int8'
assert worker.configured_language() == 'auto'
assert worker.DEFAULT_WHISPER_MODEL == 'large-v3-turbo'

model = object()
worker._whisper_model = model
worker._whisper_model_key = ("large-v3", "cuda", "float16", "test")
os.environ["LOCALFLOW_WHISPER_MODEL"] = "large-v3"
with contextlib.redirect_stdout(io.StringIO()):
    for language in ("en", "auto", "sr"):
        worker.configure_model("test", {"language": language})
        assert worker._whisper_model is model
        assert worker.configured_language() == language
    try:
        worker.configure_model("test", {"language": "invalid"})
    except ValueError:
        pass
    else:
        raise AssertionError("Invalid configuration accepted")
print("Language changes preserve the loaded model")

# Inference is lazy: consume the generator and initialize VAD before reporting ready.
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np

inferences = []
vads = []
def transcribe(audio, **options):
    assert audio.shape == (16000,)
    assert audio.dtype == np.float32
    assert options['language'] is None
    assert options['vad_filter'] is False
    assert options['max_new_tokens'] == 1
    def segments():
        inferences.append(audio)
        yield object()
    return segments(), None

fake_model = SimpleNamespace(transcribe=transcribe)
worker.reset_whisper_model()
with patch.dict(sys.modules, {
    "faster_whisper": SimpleNamespace(WhisperModel=lambda *args, **kwargs: fake_model),
    "faster_whisper.vad": SimpleNamespace(get_speech_timestamps=lambda audio: vads.append(audio)),
}), contextlib.redirect_stdout(io.StringIO()):
    worker.warmup_model("startup")
    worker.warmup_model("recording")
    assert worker.load_whisper_model("transcribe") is fake_model
    assert len(inferences) == len(vads) == 1, "Warm inference and VAD once per model"
    worker.reset_whisper_model()
    with patch.object(fake_model, "transcribe", side_effect=RuntimeError("GPU unavailable")):
        try:
            worker.warmup_model("failed")
        except RuntimeError:
            pass
        else:
            raise AssertionError("Warmup failure was ignored")
    assert worker._whisper_model is None, "A failed warmup must not be cached as ready"
    worker.warmup_model("retry")
    assert len(inferences) == len(vads) == 2
print("Full inference and VAD warmed once, reused, and retried after failure")
