from __future__ import annotations

import json
import os
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def main() -> int:
    lang_code = os.environ.get("KOKORO_LANG_CODE", "a")
    voice = os.environ.get("KOKORO_VOICE", "af_bella")
    repo_id = os.environ.get("KOKORO_REPO_ID") or None

    started = time.perf_counter()
    with redirect_stdout(sys.stderr):
        pipeline = KPipeline(lang_code=lang_code, repo_id=repo_id)
    emit({
        "type": "ready",
        "backend": "kokoro",
        "lang_code": lang_code,
        "voice": voice,
        "load_s": round(time.perf_counter() - started, 3),
    })

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            request = json.loads(raw)
            if request.get("cmd") == "quit":
                emit({"type": "bye"})
                return 0

            text = str(request.get("text") or "").strip()
            if not text:
                raise ValueError("empty text")
            out = Path(str(request.get("out") or Path(os.environ.get("TEMP", ".")) / f"kokoro_voice_{int(time.time()*1000)}.wav"))
            req_voice = str(request.get("voice") or voice)
            out.parent.mkdir(parents=True, exist_ok=True)

            t0 = time.perf_counter()
            first_s = None
            parts = []
            with redirect_stdout(sys.stderr):
                for _graphemes, _phonemes, audio in pipeline(text, voice=req_voice):
                    if first_s is None:
                        first_s = time.perf_counter() - t0
                    parts.append(audio)
            if not parts:
                raise RuntimeError("Kokoro produced no audio")
            wav = np.concatenate(parts)
            sf.write(str(out), wav, 24000)
            total_s = time.perf_counter() - t0
            audio_s = len(wav) / 24000
            emit({
                "type": "result",
                "success": True,
                "backend": "kokoro",
                "wav": str(out),
                "voice": req_voice,
                "lang_code": lang_code,
                "first_audio_s": round(first_s or total_s, 3),
                "generation_total_s": round(total_s, 3),
                "audio_duration_s": round(audio_s, 3),
                "rtf_total": round(total_s / audio_s, 3) if audio_s else None,
            })
        except Exception as exc:
            emit({"type": "error", "success": False, "error": str(exc)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
