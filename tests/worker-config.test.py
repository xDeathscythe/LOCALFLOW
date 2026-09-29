import contextlib
import io
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import worker

assert not {"faster_whisper", "numpy", "av"}.intersection(sys.modules), "Configuration must not load inference libraries"

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
