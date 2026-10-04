from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import wave
from pathlib import Path
from typing import Any
from voice_output_session import serve, check_cancelled, cancel_on_forward


VOICE_ROOT = Path(
    os.environ.get(
        "LOCALFLOW_VOICE_ROOT",
        str(Path(__file__).resolve().parents[1] / "runtime" / "tts"),
    )
)
OUTPUT_DIR = Path(os.environ.get("LOCALFLOW_VOICE_OUTPUT_DIR", str(VOICE_ROOT / "outputs")))
XTTS_REFERENCE_AUDIO = Path(
    os.environ.get(
        "LOCALFLOW_XTTS_REFERENCE_AUDIO",
        str(VOICE_ROOT / "shared" / "refs" / "hermes-reference.wav"),
    )
)
OMNIVOICE_REFERENCE_AUDIO = Path(
    os.environ.get(
        "LOCALFLOW_OMNIVOICE_REFERENCE_AUDIO",
        str(VOICE_ROOT / "shared" / "refs" / "telegram_audio_5212538fe527_mono24k.wav"),
    )
)
OMNIVOICE_SNAPSHOT = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"


def env_flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class PiperEngine:
    def __init__(self) -> None:
        from piper import PiperVoice

        model_dir = VOICE_ROOT / "piper" / "voices"
        model_name = os.environ.get(
            "LOCALFLOW_PIPER_VOICE", "en_US-kristin-medium"
        )
        self.model_path = model_dir / f"{model_name}.onnx"
        if not self.model_path.exists():
            raise FileNotFoundError(f"Piper voice not found: {self.model_path}")
        self.voice = PiperVoice.load(self.model_path)

    def synthesize(self, text: str, output: Path, cancelled=None) -> None:
        with wave.open(str(output), "wb") as wav_file:
            first = True
            for chunk in self.voice.synthesize(text):
                check_cancelled(cancelled)
                if first:
                    wav_file.setframerate(chunk.sample_rate)
                    wav_file.setsampwidth(chunk.sample_width)
                    wav_file.setnchannels(chunk.sample_channels)
                    first = False
                wav_file.writeframes(chunk.audio_int16_bytes)


class XttsEngine:
    def __init__(self) -> None:
        if not XTTS_REFERENCE_AUDIO.exists():
            raise FileNotFoundError(f"XTTS reference not found: {XTTS_REFERENCE_AUDIO}")
        os.environ.setdefault("TTS_HOME", str(VOICE_ROOT / "xtts" / "models"))
        os.environ.setdefault("COQUI_TOS_AGREED", "1")
        import torch
        from TTS.api import TTS

        if not torch.cuda.is_available():
            raise RuntimeError("XTTS requires CUDA in this LocalFlow configuration")
        self.language = os.environ.get("LOCALFLOW_XTTS_LANGUAGE", "en")
        self.tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")
        model_dir = Path(self.tts.synthesizer.checkpoint_dir)
        model_stat = (model_dir / "model.pth").stat()
        self.model_identity = repr((str(model_dir.resolve()), model_stat.st_size, model_stat.st_mtime_ns,
                                    (model_dir / "config.json").read_bytes(), importlib.metadata.version("coqui-tts")))
        self.voice_dir = OUTPUT_DIR.parent / "voice-cache" / "xtts"

    def synthesize(self, text: str, output: Path, cancelled=None) -> None:
        speaker = "localflow-" + hashlib.sha256(XTTS_REFERENCE_AUDIO.read_bytes() + self.model_identity.encode()).hexdigest()
        if not (self.voice_dir / f"{speaker}.pth").exists():
            model = self.tts.synthesizer.tts_model
            config = model.config
            model.clone_voice(str(XTTS_REFERENCE_AUDIO), speaker, self.voice_dir,
                              gpt_cond_len=config.gpt_cond_len, gpt_cond_chunk_len=config.gpt_cond_chunk_len,
                              max_ref_length=config.max_ref_len, sound_norm_refs=config.sound_norm_refs)
        with cancel_on_forward(self.tts.synthesizer.tts_model.gpt.gpt_inference, cancelled):
            self.tts.tts_to_file(
                text=text,
                speaker=speaker,
                voice_dir=self.voice_dir,
                language=self.language,
                file_path=str(output),
                split_sentences=True,
            )


class OmniVoiceEngine:
    def __init__(self) -> None:
        if not OMNIVOICE_REFERENCE_AUDIO.exists():
            raise FileNotFoundError(
                f"OmniVoice reference not found: {OMNIVOICE_REFERENCE_AUDIO}"
            )
        cache = VOICE_ROOT / "omnivoice" / "hf_home"
        os.environ["HF_HOME"] = str(cache)
        os.environ["HUGGINGFACE_HUB_CACHE"] = str(cache / "hub")
        os.environ["HF_HUB_CACHE"] = str(cache / "hub")
        snapshot = Path(
            os.environ.get(
                "LOCALFLOW_OMNIVOICE_MODEL",
                str(
                    cache
                    / "hub"
                    / "models--k2-fsa--OmniVoice"
                    / "snapshots"
                    / OMNIVOICE_SNAPSHOT
                ),
            )
        )
        if not snapshot.exists():
            raise FileNotFoundError(f"OmniVoice model snapshot not found: {snapshot}")
        import torch
        from omnivoice import OmniVoice

        if not torch.cuda.is_available():
            raise RuntimeError("OmniVoice requires CUDA in this LocalFlow configuration")
        self.model = OmniVoice.from_pretrained(
            str(snapshot), device_map="cuda:0", dtype=torch.float16
        )
        reference_text = os.environ.get("LOCALFLOW_OMNIVOICE_REFERENCE_TEXT", "").strip()
        self.voice_prompt = self.model.create_voice_clone_prompt(
            ref_audio=str(OMNIVOICE_REFERENCE_AUDIO),
            ref_text=reference_text or None,
            preprocess_prompt=env_flag(
                "LOCALFLOW_OMNIVOICE_PREPROCESS_REFERENCE", True
            ),
        )

    def synthesize(self, text: str, output: Path, cancelled=None) -> None:
        import soundfile as sf

        with cancel_on_forward(self.model.llm, cancelled):
            audio = self.model.generate(
                text=text,
                language=os.environ.get("LOCALFLOW_OMNIVOICE_LANGUAGE", "Serbian"),
                voice_clone_prompt=self.voice_prompt,
                instruct="",
                duration=None,
                speed=float(os.environ.get("LOCALFLOW_OMNIVOICE_SPEED", "0.95")),
                num_step=int(os.environ.get("LOCALFLOW_OMNIVOICE_STEPS", "32")),
                guidance_scale=float(
                    os.environ.get("LOCALFLOW_OMNIVOICE_GUIDANCE", "2.0")
                ),
                denoise=env_flag("LOCALFLOW_OMNIVOICE_DENOISE", True),
                preprocess_prompt=env_flag(
                    "LOCALFLOW_OMNIVOICE_PREPROCESS_REFERENCE", True
                ),
                postprocess_output=env_flag(
                    "LOCALFLOW_OMNIVOICE_POSTPROCESS_OUTPUT", True
                ),
            )
        sf.write(str(output), audio[0], self.model.sampling_rate)


def port_ready(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def post_json(url: str, payload: dict[str, Any], timeout: int = 180) -> str:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def find_xvasynth_root() -> Path:
    configured = os.environ.get("LOCALFLOW_XVASYNTH_ROOT")
    candidates = [
        Path(configured) if configured else None,
        VOICE_ROOT / "xvasynth",
        Path(r"X:\New folder\stema\steamapps\common\xVASynth"),
        Path(r"C:\Program Files (x86)\Steam\steamapps\common\xVASynth"),
    ]
    for candidate in candidates:
        if candidate and (candidate / "xVASynth.exe").exists():
            return candidate
    raise FileNotFoundError("xVASynth is not installed in a configured location")


class XvaSynthEngine:
    def __init__(self) -> None:
        self.root = find_xvasynth_root()
        self.url = os.environ.get("LOCALFLOW_XVASYNTH_URL", "http://127.0.0.1:8008")
        self.model_json = self._find_model()
        self.metadata = json.loads(self.model_json.read_text(encoding="utf-8"))
        self.model_base = self.model_json.with_suffix("")
        self._ensure_server()
        self._load_model()

    def _find_model(self) -> Path:
        models_root = self.root / "resources" / "app" / "models"
        voice_id = os.environ.get("LOCALFLOW_XVASYNTH_VOICE", "").strip()
        models = sorted(models_root.rglob("*.json")) if models_root.exists() else []
        models = [model for model in models if model.with_suffix(".pt").exists()]
        if voice_id:
            models = [model for model in models if model.stem == voice_id]
        if not models:
            raise FileNotFoundError(
                f"No xVASynth voice pack found under {models_root}"
            )
        return models[0]

    def _ensure_server(self) -> None:
        if port_ready(8008):
            return
        subprocess.Popen(
            [str(self.root / "xVASynth.exe")],
            cwd=str(self.root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if port_ready(8008):
                return
            time.sleep(1)
        raise TimeoutError("xVASynth server did not start on port 8008")

    def _load_model(self) -> None:
        model_type = str(self.metadata.get("modelType") or "xVAPitch")
        game = self.model_json.parent.name
        post_json(
            f"{self.url}/setAvailableVoices",
            {"modelsPaths": json.dumps({game: str(self.model_json.parent)})},
        )
        post_json(
            f"{self.url}/loadModel",
            {
                "model": str(self.model_base),
                "modelType": model_type,
                "pluginsContext": "{}",
                "base_lang": self.metadata.get("base_lang", "en"),
                "model_speakers": self.metadata.get("emb_size", 1),
            },
        )

    def synthesize(self, text: str, output: Path, cancelled=None) -> None:
        check_cancelled(cancelled)
        post_json(
            f"{self.url}/synthesizeSimple",
            {
                "sequence": text,
                "outfile": str(output),
                "base_lang": self.metadata.get("base_lang", "en"),
                "base_emb": self.metadata.get("games", [{}])[0].get("emb_i", 0),
                "useCleanup": True,
            },
        )


def load_engine(name: str) -> Any:
    engine_types = {
        "piper": PiperEngine,
        "xtts": XttsEngine,
        "omnivoice": OmniVoiceEngine,
        "xvasynth": XvaSynthEngine,
    }
    try:
        engine_type = engine_types[name]
    except KeyError as error:
        raise ValueError(f"Unsupported voice output model: {name}") from error
    with contextlib.redirect_stdout(sys.stderr):
        return engine_type()


def main() -> None:
    parser = argparse.ArgumentParser(description="Persistent LocalFlow voice output worker")
    parser.add_argument("--engine", required=True)
    args = parser.parse_args()

    serve(load_engine(args.engine), args.engine, OUTPUT_DIR)


if __name__ == "__main__":
    main()
