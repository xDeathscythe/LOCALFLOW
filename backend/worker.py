from __future__ import annotations

import json
import os
import re
import sys
import traceback
from pathlib import Path
from time import perf_counter
from typing import Any

import requests
from faster_whisper import WhisperModel

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DEFAULT_WHISPER_MODEL = "large-v3-turbo"
DEFAULT_LANGUAGE = "sr"
DEFAULT_OUTPUT_LANGUAGE = "Serbian Latin"
DEFAULT_OLLAMA_MODEL = "qwen3:8b"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_KEEP_ALIVE = "30m"
DEFAULT_WHISPER_DOWNLOAD_ROOT = "X:\\stt-models"
ASR_EXAMPLES_BY_LANGUAGE = {
    "sr": [
        ("Kako je dano slabedan?", "Kako je danas lep dan?"),
        ("Kako je dano lepdan?", "Kako je danas lep dan?"),
        ("Ja sam danas isao use prodavnicu.", "Ja sam danas isao u prodavnicu."),
    ],
}

_whisper_model: WhisperModel | None = None
_whisper_model_key: tuple[str, str, str, str] | None = None
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


def resolve_device() -> str:
    configured = env("LOCALFLOW_WHISPER_DEVICE", "cuda")
    if configured == "auto":
        return "auto"
    return configured


def resolve_compute_type() -> str:
    configured = env("LOCALFLOW_WHISPER_COMPUTE_TYPE", "float16")
    if configured == "auto":
        return "auto"
    return configured


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

    emit(
        {
            "id": request_id,
            "type": "progress",
            "stage": "loading-whisper",
            "message": f"Loading local Whisper model: {model_name}",
        }
    )
    started = perf_counter()
    _whisper_model = WhisperModel(model_name, device=device, compute_type=compute_type, download_root=download_root)
    _whisper_model_key = key
    emit(
        {
            "id": request_id,
            "type": "progress",
            "stage": "whisper-ready",
            "message": f"Whisper model ready in {perf_counter() - started:.1f}s",
        }
    )
    return _whisper_model


def warmup_model(request_id: str) -> None:
    load_whisper_model(request_id)
    emit({"id": request_id, "type": "result", "ok": True, "data": {"ready": True}})


def transcribe_audio(request_id: str, audio_path: str) -> dict[str, Any]:
    path = Path(audio_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Audio file does not exist: {audio_path}")

    language = env("LOCALFLOW_WHISPER_LANGUAGE", DEFAULT_LANGUAGE)
    try:
        model = load_whisper_model(request_id)
        segments, info, started = run_whisper_transcription(request_id, model, path, language)
    except RuntimeError as exc:
        if (
            not is_cuda_runtime_missing(exc)
            or resolve_device() == "cpu"
            or not env_bool("LOCALFLOW_ALLOW_CPU_FALLBACK", False)
        ):
            raise
        emit(
            {
                "id": request_id,
                "type": "progress",
                "stage": "cpu-fallback",
                "message": "CUDA runtime is unavailable; retrying locally on CPU int8.",
            }
        )
        os.environ["LOCALFLOW_WHISPER_DEVICE"] = "cpu"
        os.environ["LOCALFLOW_WHISPER_COMPUTE_TYPE"] = "int8"
        reset_whisper_model()
        model = load_whisper_model(request_id)
        segments, info, started = run_whisper_transcription(request_id, model, path, language)

    raw_segments = []
    for segment in segments:
        raw_segments.append(
            {
                "start": segment.start,
                "end": segment.end,
                "text": to_serbian_latin(segment.text.strip()),
            }
        )

    transcript = " ".join(item["text"] for item in raw_segments).strip()
    transcript = to_serbian_latin(transcript)
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
        "language": getattr(info, "language", language),
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
        language=language,
        task="transcribe",
        initial_prompt=env(
            "LOCALFLOW_WHISPER_INITIAL_PROMPT",
            "Ovo je srpski govor na srpskoj latinici. Transkribuj samo srpski jezik latinicom.",
        ),
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


def is_cuda_runtime_missing(exc: RuntimeError) -> bool:
    message = str(exc).lower()
    return any(part in message for part in ("cublas", "cudnn", "cuda", "cufft", "cannot be loaded"))


def language_family(language: str) -> str:
    return language.strip().lower().replace("_", "-").split("-")[0]


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


def build_polish_prompt(transcript: str, options: dict[str, Any], language: str, output_language: str) -> str:
    level = cleanup_level(options)
    context = recent_context_text()
    level_rules = {
        "light": [
            "Apply only light cleanup: punctuation, capitalization, spacing, obvious filler removal, and obvious ASR near-miss correction.",
            "Do not rewrite style. Do not shorten meaning. Keep the user's wording unless it is clearly a transcription or filler issue.",
        ],
        "medium": [
            "Apply medium cleanup: make sentences logical, natural, and slightly tighter while preserving the user's feeling, tone, and way of speaking.",
            "You may lightly reorder words, remove repeated fragments, and fix unclear phrasing, but do not make it sound like a different person.",
        ],
        "high": [
            "Apply high cleanup: infer the user's final intended meaning from the whole utterance, remove false starts and self-corrections, and make the result compact and concrete.",
            "When the user changes their mind mid-sentence, keep the final decision only.",
            "Example: 'danas bi trebalo, možda ipak, sutra, ne, danas, ne, ne, ajde ovako, sutra ću da odem na bazen' -> 'Sutra idem na bazen.'",
        ],
    }
    rules = [
        "You are a local dictation post-processing engine.",
        f"The output language is {output_language}.",
        "First decide whether the transcript is ordinary dictated text or a spoken instruction to translate text.",
        "If it is a translation instruction, translate the dictated content and omit the instruction itself.",
        "Translation instructions override the normal output language.",
        "If the user asks to translate without naming a target language, use English as the target language.",
        "If the user names a target language, use that target language.",
        "If it is not a translation instruction, do not translate.",
        f"For ordinary dictated text, action must be dictate and text must stay in {output_language}.",
        "For Serbian output, use Serbian Latin only. Never output Serbian Cyrillic unless the target language is explicitly Serbian Cyrillic.",
        "Treat hesitation sounds and filler tokens as removable noise; never expand them into real words.",
        "Use recent context only when it clearly continues the same thought; ignore it when the current transcript starts a new topic.",
        "Return only valid compact JSON with exactly these fields: action, target_language, text.",
        "action must be either dictate or translate. target_language is null for dictate.",
        "",
        f"Cleanup level: {level}",
        *level_rules.get(level, level_rules["light"]),
    ]

    if context:
        rules.append("")
        rules.append(f"Recent context: {context}")

    examples = ASR_EXAMPLES_BY_LANGUAGE.get(language_family(language), [])
    if examples:
        rules.append("")
        rules.append("ASR correction examples:")
        for raw, corrected in examples:
            rules.append(f"Whisper: {raw}")
            rules.append(f"JSON: {json.dumps({'action': 'dictate', 'target_language': None, 'text': corrected}, ensure_ascii=False)}")

    behavior_examples = [
        (
            "pa znači ja sam ovaj danas pričao sa Markom um i mislim da treba da krenemo sledeće nedelje",
            {"action": "dictate", "target_language": None, "text": "Danas sam pričao sa Markom i mislim da treba da krenemo sledeće nedelje."},
        ),
        (
            "translate ovo je dobar dan i želim da idem kući",
            {"action": "translate", "target_language": "English", "text": "This is a good day and I want to go home."},
        ),
        (
            "prevedi na kineski danas je lep dan",
            {"action": "translate", "target_language": "Chinese", "text": "今天天气很好。"},
        ),
        (
            "prevedi na engleski danas je lep dan",
            {"action": "translate", "target_language": "English", "text": "Today is a beautiful day."},
        ),
        (
            "danas bi trebalo možda ipak sutra ne danas ne ne ajde ovako sutra ću da odem na bazen",
            {"action": "dictate", "target_language": None, "text": "Sutra idem na bazen."},
        ),
    ]
    rules.append("")
    rules.append("Behavior examples:")
    for raw, parsed in behavior_examples:
        rules.append(f"Whisper: {raw}")
        rules.append(f"JSON: {json.dumps(parsed, ensure_ascii=False)}")

    return "\n".join(rules) + f"\n\nWhisper transcript: {transcript}\nJSON:"


def extract_json_object(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    candidates = [stripped]
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        candidates.append(stripped[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def clean_polished_text(text: str, translate: bool = False) -> str:
    cleaned = text.strip() if translate else to_serbian_latin(text).strip()
    for prefix in ("Corrected:", "Polished:", "Output:"):
        if cleaned.lower().startswith(prefix.lower()):
            cleaned = cleaned[len(prefix) :].strip()
    return cleaned


def polish_with_ollama(request_id: str, transcript: str, options: dict[str, Any]) -> str:
    if not transcript.strip():
        return ""

    level = cleanup_level(options)
    if level == "none":
        cleaned_transcript = to_serbian_latin(transcript)
        remember_context(cleaned_transcript)
        return cleaned_transcript

    ollama_url = env("LOCALFLOW_OLLAMA_URL", DEFAULT_OLLAMA_URL).rstrip("/")
    ollama_model = env("LOCALFLOW_OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
    ollama_keep_alive = env("LOCALFLOW_OLLAMA_KEEP_ALIVE", DEFAULT_OLLAMA_KEEP_ALIVE)
    language = env("LOCALFLOW_WHISPER_LANGUAGE", DEFAULT_LANGUAGE)
    output_language = env("LOCALFLOW_OUTPUT_LANGUAGE", DEFAULT_OUTPUT_LANGUAGE)

    prompt = build_polish_prompt(transcript, options, language, output_language)

    emit(
        {
            "id": request_id,
            "type": "progress",
            "stage": "polishing",
            "message": f"Polishing locally with Ollama model: {ollama_model}, level={level}",
        }
    )
    response = requests.post(
        f"{ollama_url}/api/generate",
        json={
            "model": ollama_model,
            "prompt": prompt,
            "stream": False,
            "think": False,
            "keep_alive": ollama_keep_alive,
            "options": {
                "temperature": 0,
                "top_p": 0.8,
                "repeat_penalty": 1.05,
                "num_predict": max(512, min(2048, len(transcript) // 2 + 256)),
                "stop": ["\nWhisper:"],
            },
        },
        timeout=600,
    )
    response.raise_for_status()
    data = response.json()
    response_text = str(data.get("response", ""))
    parsed = extract_json_object(response_text)
    is_translation = False
    if parsed and isinstance(parsed.get("text"), str):
        is_translation = parsed.get("action") == "translate"
        polished = clean_polished_text(parsed["text"], translate=is_translation)
    else:
        polished = clean_polished_text(response_text)
    polished = polished or to_serbian_latin(transcript)
    if not is_translation:
        remember_context(polished)
    return polished


def handle_transcribe(payload: dict[str, Any]) -> None:
    request_id = str(payload.get("id") or "")
    params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
    audio_path = str(params.get("path") or "")
    options = params.get("options") if isinstance(params.get("options"), dict) else {}

    result = transcribe_audio(request_id, audio_path)
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
    polished = polish_with_ollama(request_id, result["text"], options)
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


def handle_line(line: str) -> None:
    payload = json.loads(line)
    request_id = str(payload.get("id") or "")
    action = payload.get("action")
    try:
        if action == "transcribe":
            handle_transcribe(payload)
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


def main() -> None:
    emit(
        {
            "type": "ready",
            "config": {
                "whisperModel": env("LOCALFLOW_WHISPER_MODEL", DEFAULT_WHISPER_MODEL),
                "whisperDownloadRoot": resolve_whisper_download_root(),
                "language": env("LOCALFLOW_WHISPER_LANGUAGE", DEFAULT_LANGUAGE),
                "outputLanguage": env("LOCALFLOW_OUTPUT_LANGUAGE", DEFAULT_OUTPUT_LANGUAGE),
                "ollamaModel": env("LOCALFLOW_OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL),
                "ollamaUrl": env("LOCALFLOW_OLLAMA_URL", DEFAULT_OLLAMA_URL),
            },
        }
    )
    for line in sys.stdin:
        line = line.strip()
        if line:
            handle_line(line)


if __name__ == "__main__":
    main()
