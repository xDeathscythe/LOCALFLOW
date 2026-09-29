from __future__ import annotations

import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from onnx_stt import CANARY_LANGUAGE_CODES, decode_audio, is_onnx_stt_model


assert is_onnx_stt_model("nemo-parakeet-tdt-0.6b-v3")
assert is_onnx_stt_model("nemo-canary-1b-v2")
assert not is_onnx_stt_model("large-v3")
assert CANARY_LANGUAGE_CODES == {"sr": "hr", "en": "en", "auto": "en"}

with tempfile.TemporaryDirectory() as temp_dir:
    audio_path = Path(temp_dir) / "silence.wav"
    with wave.open(str(audio_path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16_000)
        output.writeframes(np.zeros(1_600, dtype=np.int16).tobytes())
    waveform, duration = decode_audio(audio_path)
    assert waveform.dtype == np.float32
    assert waveform.shape == (1_600,)
    assert abs(duration - 0.1) < 0.001

print("STT model adapter ok")
