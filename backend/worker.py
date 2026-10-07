from __future__ import annotations

import json
import os
import re
import sys
import traceback
from pathlib import Path
from time import perf_counter
from typing import Any

from codex_cleanup import clean_transcript
from host_cleanup import clean_with_host, next_command, begin_job, end_job, check_cancelled
from onnx_stt import is_onnx_stt_model, load_model as load_onnx_stt_model, model_cache_root, model_label, transcribe as transcribe_onnx

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DEFAULT_WHISPER_MODEL = "large-v3"
DEFAULT_LANGUAGE = "auto"
DEFAULT_CLEANUP_MODEL = "gpt-5.6-terra"
DEFAULT_CLEANUP_REASONING_EFFORT = "medium"
DEFAULT_CLEANUP_TIMEOUT = 180
DEFAULT_WHISPER_DOWNLOAD_ROOT = str(Path(__file__).resolve().parents[1] / "models" / "whisper")
# Exact provider codes from the pinned faster-whisper 1.2.1 tokenizer; no speech keyword routing.
ALLOWED_LANGUAGES = {"auto", *json.loads(Path(__file__).with_name("whisper-languages.json").read_text(encoding="utf-8"))}
LANGUAGE_OUTPUTS = {"sr": "Serbian Latin", "en": "English"}
WHISPER_INITIAL_PROMPTS = {
    "sr": "Ovo je srpski govor na srpskoj latinici. Transkribuj samo srpski jezik latinicom.",
    "en": "This is natural English speech. Transcribe it in English without translating it.",
}

_whisper_model: WhisperModel | None = None
_whisper_model_key: tuple[str, str, str, str] | None = None
_onnx_stt_model: Any = None
_onnx_stt_model_name: str | None = None
_recent_context_sentences: list[str] = []

CYRILLIC_TO_SERBIAN_LATIN = str.maketrans(
    {
        "А": "A",
        "Б": "B",
        "В": "V",
        "Г": "G",
        "Д": "D",
        "Ђ": "Đ",
        "Е": "E",
        "Ж": "Ž",
        "З": "Z",
        "И": "I",
        "Ј": "J",
        "К": "K",
        "Л": "L",
        "Љ": "Lj",
        "М": "M",
        "Н": "N",
        "Њ": "Nj",
        "О": "O",
        "П": "P",
        "Р": "R",
        "С": "S",
        "Т": "T",
        "Ћ": "Ć",
        "У": "U",
        "Ф": "F",
        "Х": "H",
        "Ц": "C",
        "Ч": "Č",
        "Џ": "Dž",
        "Ш": "Š",
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "ђ": "đ",
        "е": "e",
        "ж": "ž",
        "з": "z",
        "и": "i",
        "ј": "j",
        "к": "k",
        "л": "l",
        "љ": "lj",
        "м": "m",
        "н": "n",
        "њ": "nj",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "ћ": "ć",
        "у": "u",
        "ф": "f",
        "х": "h",
        "ц": "c",
        "ч": "č",
        "џ": "dž",
        "ш": "š",
    }
)


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def env(name: str, fallback: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or fallback


def env_int(name: str, fallback: int) -> int:
    value = os.environ.get(name, "").strip()
    if not value:
        return fallback
    try:
        return int(value)
    except ValueError:
        return fallback


def env_bool(name: str, fallback: bool) -> bool:
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return fallback
    return value in {"1", "true", "yes", "on"}


def to_serbian_latin(text: str) -> str:
    return text.translate(CYRILLIC_TO_SERBIAN_LATIN)


def configured_language() -> str:
    language = env("LOCALFLOW_WHISPER_LANGUAGE", DEFAULT_LANGUAGE).lower()
    return language if language in ALLOWED_LANGUAGES else DEFAULT_LANGUAGE


def output_language_for(configured: str, detected: str | None = None) -> str:
    if configured == "auto" and not detected:
        return "Original language"
    language = detected if configured == "auto" else configured
    return LANGUAGE_OUTPUTS.get(language or "", f"the detected original language ({language or 'auto'})")


def normalize_transcript_text(text: str, configured: str, detected: str | None = None) -> str:
    return to_serbian_latin(text) if configured == "sr" or (configured == "auto" and detected == "sr") else text


def resolve_device() -> str:
    return env("LOCALFLOW_WHISPER_DEVICE", "auto")


def resolve_compute_type() -> str:
    return env("LOCALFLOW_WHISPER_COMPUTE_TYPE", "auto")


def resolve_whisper_download_root() -> str:
    return env("LOCALFLOW_WHISPER_DOWNLOAD_ROOT", DEFAULT_WHISPER_DOWNLOAD_ROOT)


def load_whisper_model(request_id: str) -> WhisperModel:
    global _whisper_model, _whisper_model_key

    model_name = env("LOCALFLOW_WHISPER_MODEL", DEFAULT_WHISPER_MODEL)
    device = resolve_device()
    compute_type = resolve_compute_type()
    download_root = resolve_whisper_download_root()
    key = (model_name, device, compute_type, download_root)

    if _whisper_model is not None and _whisper_model_key == key:
        return _whisper_model

    started = perf_counter()
    from whisper_runtime import load_profile
    model, runtime = load_profile(model_name, device, compute_type, download_root, DEFAULT_WHISPER_DOWNLOAD_ROOT,
                                  lambda message: emit({"id": request_id, "type": "progress", "stage": "loading-whisper", "message": message}))
    _whisper_model = model
    _whisper_model_key = key
    emit(
        {
            "id": request_id,
            "type": "progress",
            "stage": "whisper-ready",
            "message": f"Whisper {runtime['model']} ready on {runtime['device'].upper()} in {perf_counter() - started:.1f}s",
            "speechRuntime": runtime,
        }
    )
    return _whisper_model


def load_onnx_model(request_id: str, model_name: str):
    global _onnx_stt_model, _onnx_stt_model_name

    if _onnx_stt_model is not None and _onnx_stt_model_name == model_name:
        return _onnx_stt_model

    emit(
        {
            "id": request_id,
            "type": "progress",
            "stage": "loading-stt",
            "message": f"Loading local {model_label(model_name)} model",
        }
    )
    from model_downloads import resolve_model
    resolve_model(model_name, resolve_whisper_download_root(), DEFAULT_WHISPER_DOWNLOAD_ROOT)
    started = perf_counter()
    _onnx_stt_model = load_onnx_stt_model(model_name)
    _onnx_stt_model_name = model_name
    emit(
        {
            "id": request_id,
            "type": "progress",
            "stage": "stt-ready",
            "message": f"{model_label(model_name)} ready in {perf_counter() - started:.1f}s",
        }
    )
    return _onnx_stt_model


def warmup_model(request_id: str) -> None:
    model_name = env("LOCALFLOW_WHISPER_MODEL", DEFAULT_WHISPER_MODEL)
    if is_onnx_stt_model(model_name):
        load_onnx_model(request_id, model_name)
    else:
        load_whisper_model(request_id)
    emit({"id": request_id, "type": "result", "ok": True, "data": {"ready": True}})


def transcribe_audio(request_id: str, audio_path: str, language: str | None = None) -> dict[str, Any]:
    path = Path(audio_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Audio file does not exist: {audio_path}")

    language = language or configured_language()
    if language not in ALLOWED_LANGUAGES:
        raise ValueError("Unsupported transcription language")
    model_name = env("LOCALFLOW_WHISPER_MODEL", DEFAULT_WHISPER_MODEL)
    if is_onnx_stt_model(model_name):
        emit(
            {
                "id": request_id,
                "type": "progress",
                "stage": "transcribing",
                "message": f"Transcribing locally with {model_label(model_name)}",
            }
        )
        started = perf_counter()
        result = transcribe_onnx(
            load_onnx_model(request_id, model_name),
            model_name,
            path,
            language,
            env_int("LOCALFLOW_WHISPER_VAD_SPEECH_PAD_MS", 400),
        )
        result["segments"] = [
            {
                **segment,
                "text": normalize_transcript_text(segment["text"], language, result["language"]),
            }
            for segment in result["segments"]
        ]
        result["text"] = normalize_transcript_text(result["text"], language, result["language"])
        emit(
            {
                "id": request_id,
                "type": "progress",
                "stage": "transcribed",
                "message": f"{model_label(model_name)} finished in {perf_counter() - started:.1f}s",
            }
        )
        return result

    model = load_whisper_model(request_id)
    segments, info, started = run_whisper_transcription(request_id, model, path, language)

    detected_language = getattr(info, "language", language)
    raw_segments = []
    for segment in segments:
        check_cancelled(request_id)
        raw_segments.append(
            {
                "start": segment.start,
                "end": segment.end,
                "text": normalize_transcript_text(segment.text.strip(), language, detected_language),
            }
        )

    transcript = " ".join(item["text"] for item in raw_segments).strip()
    transcript = normalize_transcript_text(transcript, language, detected_language)
    emit(
        {
            "id": request_id,
            "type": "progress",
            "stage": "transcribed",
            "message": f"Whisper finished in {perf_counter() - started:.1f}s",
        }
    )
    return {
        "text": transcript,
        "language": detected_language,
        "duration": getattr(info, "duration", None),
        "segments": raw_segments,
    }


def run_whisper_transcription(request_id: str, model: WhisperModel, path: Path, language: str):
    beam_size = env_int("LOCALFLOW_WHISPER_BEAM_SIZE", 1)
    vad_filter = env_bool("LOCALFLOW_WHISPER_VAD_FILTER", True)
    vad_speech_pad_ms = env_int("LOCALFLOW_WHISPER_VAD_SPEECH_PAD_MS", 400)
    emit(
        {
            "id": request_id,
            "type": "progress",
            "stage": "transcribing",
            "message": f"Transcribing with language={language}, beam={beam_size}, vad_pad={vad_speech_pad_ms}ms",
        }
    )
    started = perf_counter()
    vad_parameters = {"speech_pad_ms": vad_speech_pad_ms} if vad_filter else None
    segments, info = model.transcribe(
        str(path),
        language=None if language == "auto" else language,
        task="transcribe",
        initial_prompt=WHISPER_INITIAL_PROMPTS.get(language),
        vad_filter=vad_filter,
        vad_parameters=vad_parameters,
        beam_size=beam_size,
        best_of=1,
        temperature=0,
        condition_on_previous_text=False,
    )
    return segments, info, started


def reset_whisper_model() -> None:
    global _whisper_model, _whisper_model_key
    _whisper_model = None
    _whisper_model_key = None


def cleanup_level(options: dict[str, Any]) -> str:
    level = str(options.get("cleanupLevel") or "").strip().lower()
    if level in {"none", "light", "medium", "high"}:
        return level
    return "light" if bool(options.get("cleanup", True)) else "none"


def recent_context_text() -> str:
    return " ".join(_recent_context_sentences[-2:]).strip()


def remember_context(text: str) -> None:
    global _recent_context_sentences
    if not text.strip():
        return
    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]
    if not parts:
        parts = [text.strip()]
    _recent_context_sentences = (_recent_context_sentences + parts)[-2:]


def build_polish_prompt(transcript: str, options: dict[str, Any], language: str, output_language: str, realtime: bool = False) -> str:
    level = cleanup_level(options)
    context = recent_context_text()
    level_rules = {
        "light": "Fix punctuation, capitalization, spacing, hesitation, and obvious speech-recognition errors. Preserve the user's wording and every fact.",
        "medium": "Make the dictation natural and clear. Remove false starts, repeated fragments, hesitation, and self-corrections while preserving the user's tone.",
        "high": "Rewrite as clean, natural, compact dictation. Remove false starts, repetition, hesitation, and self-corrections. When the speaker corrects a fact, keep only the final fact.",
    }
    rules = [
        "You edit automatic speech-recognition transcripts in whatever language they use.",
        "Return a compact JSON metadata header with exactly action and target_language, followed by a newline and the cleaned text as plain text. Do not wrap the text in quotes or JSON." if realtime else "Return only compact JSON with exactly these fields: action, target_language, text.",
        "action must be either dictate or translate. target_language is null for dictate.",
        f"The transcript language hint is {language}. The normal output language is {output_language}.",
        "Use action translate only when the speaker explicitly dictates a request to translate content; otherwise use dictate.",
        "For translate, omit the spoken instruction and translate its content to the requested target language, or English when no target is specified.",
        f"For dictate, keep the text in {output_language}. Do not translate it.",
        f"Cleanup level {level}: {level_rules.get(level, level_rules['light'])}",
        "This is error correction, not creative rewriting.",
        "Silently reconstruct words that ASR split, merged, or heard phonetically.",
        "Prefer the smallest sound-level and word-boundary changes that produce a common, grammatical, and semantically coherent phrase in context.",
        "Do not rationalize an impossible phrase or replace it with an unrelated idea.",
        "Use the entire transcript as evidence: when a later clause reveals the activity, use it to disambiguate an earlier phonetically corrupted phrase.",
        "Preserve the speaker's final meaning and tone. Do not add facts.",
    ]

    if context:
        rules.append(f"Recent context, only if this transcript clearly continues it: {context}")

    return "\n".join(rules) + f"\n\nTranscript:\n{transcript}\n\n" + ("Metadata header and cleaned text:" if realtime else "JSON:")


def clean_polished_text(text: str, translate: bool = False, serbian_latin: bool = False) -> str:
    return to_serbian_latin(text).strip() if serbian_latin and not translate else text.strip()


def polish_transcript(request_id: str, transcript: str, options: dict[str, Any], detected_language: str) -> str:
    if not transcript.strip():
        return ""

    level = cleanup_level(options)
    if level == "none":
        remember_context(transcript)
        return ""

    model = env("LOCALFLOW_CLEANUP_MODEL", DEFAULT_CLEANUP_MODEL)
    reasoning_effort = env("LOCALFLOW_CLEANUP_REASONING_EFFORT", DEFAULT_CLEANUP_REASONING_EFFORT)
    timeout = env_int("LOCALFLOW_CLEANUP_TIMEOUT", DEFAULT_CLEANUP_TIMEOUT)
    language = configured_language()
    output_language = output_language_for(language, detected_language)

    prompt = build_polish_prompt(transcript, options, language, output_language, realtime=model == "gpt-live-1-codex")

    emit(
        {
            "id": request_id,
            "type": "progress",
            "stage": "polishing",
            "message": f"Polishing with Codex {model}, level={level}",
        }
    )
    parsed = clean_with_host(prompt, timeout) if model == "gpt-live-1-codex" else clean_transcript(prompt, model, reasoning_effort, timeout)
    is_translation = parsed.get("action") == "translate"
    polished = clean_polished_text(
        parsed["text"],
        translate=is_translation,
        serbian_latin=language == "sr" or (language == "auto" and detected_language == "sr"),
    )
    if not polished:
        raise RuntimeError("Codex cleanup returned empty text")
    if not is_translation:
        remember_context(polished)
    return polished


def handle_transcribe(payload: dict[str, Any]) -> None:
    request_id = str(payload.get("id") or "")
    params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
    audio_path = str(params.get("path") or "")
    options = params.get("options") if isinstance(params.get("options"), dict) else {}

    transcript_only = options.get("transcriptOnly") is True
    result = transcribe_audio(request_id, audio_path, str(options.get("language") or "auto")) if transcript_only else transcribe_audio(request_id, audio_path)
    check_cancelled(request_id)
    emit(
        {
            "id": request_id,
            "type": "partial-result",
            "data": {
                "rawText": result["text"],
                "polishedText": "",
                "language": result["language"],
                "duration": result["duration"],
                "segments": result["segments"],
            },
        }
    )
    # Meeting evidence must neither be rewritten nor enter the dictation context.
    polished = "" if transcript_only else polish_transcript(request_id, result["text"], options, result["language"])
    check_cancelled(request_id)
    emit(
        {
            "id": request_id,
            "type": "result",
            "ok": True,
            "data": {
                "rawText": result["text"],
                "polishedText": polished,
                "language": result["language"],
                "duration": result["duration"],
                "segments": result["segments"],
            },
        }
    )


def configure_model(request_id: str, params: dict[str, Any]) -> None:
    global _onnx_stt_model, _onnx_stt_model_name
    language = params.get("language")
    model = params.get("model")
    if params.get("cleanupModel"):
        os.environ["LOCALFLOW_CLEANUP_MODEL"] = params["cleanupModel"]
    if language is not None:
        if language not in ALLOWED_LANGUAGES:
            raise ValueError("Unsupported transcription language")
        os.environ["LOCALFLOW_WHISPER_LANGUAGE"] = language
    if model is not None:
        if model not in {"base", "small", "large-v3", "large-v3-turbo"} and not is_onnx_stt_model(model):
            raise ValueError("Unsupported transcription model")
        previous = env("LOCALFLOW_WHISPER_MODEL", DEFAULT_WHISPER_MODEL)
        if model != previous:
            reset_whisper_model()
            _onnx_stt_model = None
            _onnx_stt_model_name = None
            os.environ["LOCALFLOW_WHISPER_MODEL"] = model
        try:
            warmup_model(request_id)
        except Exception:
            os.environ["LOCALFLOW_WHISPER_MODEL"] = previous
            raise
        return
    emit({"id": request_id, "type": "result", "ok": True, "data": {"language": configured_language()}})


def handle_line(line: str) -> None:
    payload = json.loads(line)
    request_id = str(payload.get("id") or "")
    action = payload.get("action")
    try:
        begin_job(request_id)
        if action == "transcribe":
            handle_transcribe(payload)
            return
        if action in {"model-status", "download-model"}:
            from model_downloads import model_available, resolve_model
            model = (payload.get("params") or {}).get("model")
            roots = (resolve_whisper_download_root(), DEFAULT_WHISPER_DOWNLOAD_ROOT)
            if action == "download-model":
                emit({"id": request_id, "type": "progress", "stage": "downloading-model", "message": f"Downloading {model} from Hugging Face…"})
                resolve_model(model, *roots, download=True)
            emit({"id": request_id, "type": "result", "ok": True, "data": {"available": model_available(model, *roots)}})
            return
        if action == "configure":
            configure_model(request_id, payload.get("params") or {})
            return
        if action == "warmup":
            warmup_model(request_id)
            return
        raise ValueError(f"Unsupported worker action: {action}")
    except Exception as exc:
        emit(
            {
                "id": request_id,
                "type": "result",
                "ok": False,
                "error": str(exc),
                "trace": traceback.format_exc(),
            }
        )
    finally:
        end_job(request_id)


def main() -> None:
    # NumPy's Windows DLL initialization deadlocks if a pipe reader is already blocked.
    # All speech engines use NumPy; initialize it before starting that reader.
    import numpy

    model_name = env("LOCALFLOW_WHISPER_MODEL", DEFAULT_WHISPER_MODEL)
    emit(
        {
            "type": "ready",
            "config": {
                "whisperModel": model_name,
                "whisperDownloadRoot": model_cache_root() if is_onnx_stt_model(model_name) else resolve_whisper_download_root(),
                "language": configured_language(),
                "outputLanguage": output_language_for(configured_language()),
                "cleanupEngine": "Codex OAuth",
                "cleanupModel": env("LOCALFLOW_CLEANUP_MODEL", DEFAULT_CLEANUP_MODEL),
            },
        }
    )
    while True:
        line = next_command()
        if not line:
            break
        line = line.strip()
        if line:
            handle_line(line)


if __name__ == "__main__":
    main()
