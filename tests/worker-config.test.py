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

# Loading weights alone leaves the first dictation paying for lazy GPU startup.
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np

encodes = []
def encode(features):
    assert features.shape == (128, 3000)
    assert features.dtype == np.float32
    encodes.append(features)

fake_model = SimpleNamespace(model=SimpleNamespace(n_mels=128),
                             feature_extractor=SimpleNamespace(nb_max_frames=3000), encode=encode)
worker.reset_whisper_model()
with patch.dict(sys.modules, {"faster_whisper": SimpleNamespace(WhisperModel=lambda *args, **kwargs: fake_model)}), contextlib.redirect_stdout(io.StringIO()):
    worker.warmup_model("startup")
    worker.warmup_model("recording")
    assert worker.load_whisper_model("transcribe") is fake_model
    assert len(encodes) == 1, "Warm the encoder once per loaded model, never once per recording"
    worker.reset_whisper_model()
    with patch.object(fake_model, "encode", side_effect=RuntimeError("GPU unavailable")):
        try:
            worker.warmup_model("failed")
        except RuntimeError:
            pass
        else:
            raise AssertionError("Warmup failure was ignored")
    assert worker._whisper_model is None, "A failed warmup must not be cached as ready"
    worker.warmup_model("retry")
    assert len(encodes) == 2
print("Encoder warmed once, reused, and retried after failure")
