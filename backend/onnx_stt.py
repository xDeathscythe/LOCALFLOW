from __future__ import annotations

import os
from pathlib import Path
from typing import Any


ONNX_STT_MODELS = {
    "nemo-parakeet-tdt-0.6b-v3": "Parakeet TDT 0.6B V3",
    "nemo-canary-1b-v2": "Canary 1B V2",
}
CANARY_LANGUAGE_CODES = {"sr": "hr", "en": "en", "auto": "en"}


def is_onnx_stt_model(model_name: str) -> bool:
    return model_name in ONNX_STT_MODELS


def model_label(model_name: str) -> str:
    return ONNX_STT_MODELS[model_name]


def model_cache_root() -> str:
    configured = os.environ.get("HUGGINGFACE_HUB_CACHE") or os.environ.get("HF_HUB_CACHE")
    if configured:
        return configured
    hf_home = os.environ.get("HF_HOME")
    return str(Path(hf_home) / "hub") if hf_home else str(Path.home() / ".cache" / "huggingface" / "hub")


def load_model(model_name: str):
    import onnx_asr

    if model_name not in ONNX_STT_MODELS:
        raise ValueError(f"Unsupported ONNX STT model: {model_name}")
    quantization = os.environ.get("LOCALFLOW_ONNX_STT_QUANTIZATION", "int8").strip() or "int8"
    return onnx_asr.load_model(model_name, quantization=quantization, offline=True)


def decode_audio(audio_path: Path) -> tuple[np.ndarray, float]:
    import av
    import numpy as np

    chunks: list[np.ndarray] = []
    resampler = av.AudioResampler(format="flt", layout="mono", rate=16_000)
    with av.open(str(audio_path)) as container:
        if not container.streams.audio:
            raise ValueError(f"Audio file has no audio stream: {audio_path}")
        for frame in container.decode(container.streams.audio[0]):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray().reshape(-1))
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().reshape(-1))
    waveform = np.concatenate(chunks).astype(np.float32, copy=False) if chunks else np.empty(0, dtype=np.float32)
    return waveform, len(waveform) / 16_000


def transcribe(model: Any, model_name: str, audio_path: Path, language: str, speech_pad_ms: int) -> dict[str, Any]:
    waveform, duration = decode_audio(audio_path)
    if waveform.size == 0:
        return {"text": "", "language": language, "duration": 0.0, "segments": []}

    options: dict[str, Any] = {}
    detected_language = language
    if model_name == "nemo-canary-1b-v2":
        detected_language = CANARY_LANGUAGE_CODES[language]
        options = {"language": detected_language, "target_language": detected_language, "pnc": True}

    if duration <= 20:
        text = model.recognize(waveform, sample_rate=16_000, **options).strip()
        segments = [{"start": 0.0, "end": duration, "text": text}] if text else []
    else:
        import onnx_asr

        vad = onnx_asr.load_vad("silero", offline=True)
        results = model.with_vad(vad, batch_size=1, max_speech_duration_s=20, speech_pad_ms=speech_pad_ms).recognize(
            waveform,
            sample_rate=16_000,
            **options,
        )
        segments = [
            {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
            for segment in results
            if segment.text.strip()
        ]
        text = " ".join(segment["text"] for segment in segments).strip()

    return {"text": text, "language": detected_language, "duration": duration, "segments": segments}
