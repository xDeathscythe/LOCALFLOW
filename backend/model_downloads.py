"""Local availability checks and explicitly requested model downloads."""
from pathlib import Path
from onnx_stt import is_onnx_stt_model

WHISPER_MODELS = {"base", "small", "large-v3", "large-v3-turbo"}
WHISPER_FILES = ("model.bin", "config.json", "tokenizer.json")


def whisper_path(name, download_root, bundled_root):
    if name not in WHISPER_MODELS:
        raise ValueError("Unsupported transcription model")
    for root in (download_root, bundled_root):
        folder = Path(root) / name
        if all((folder / file).is_file() for file in WHISPER_FILES):
            return str(folder)
    # ponytail: reuse the dependency's offline cache lookup and resumable download.
    from faster_whisper.utils import download_model
    folder = Path(download_model(name, cache_dir=download_root, local_files_only=True))
    if not all((folder / file).is_file() for file in WHISPER_FILES):
        raise FileNotFoundError(f"Whisper {name} is incomplete. Select it in Settings to download its files.")
    return str(folder)


def resolve_model(name, download_root, bundled_root, download=False):
    if is_onnx_stt_model(name):
        from onnx_asr.loader import create_asr_resolver, create_vad_resolver
        create_asr_resolver(name, offline=not download).resolve_model(quantization="int8")
        create_vad_resolver("silero", offline=not download).resolve_model()
    elif download:
        if name not in WHISPER_MODELS:
            raise ValueError("Unsupported transcription model")
        from faster_whisper.utils import download_model
        download_model(name, output_dir=str(Path(download_root) / name))
    else:
        whisper_path(name, download_root, bundled_root)


def model_available(name, download_root, bundled_root):
    from huggingface_hub.errors import LocalEntryNotFoundError
    try:
        resolve_model(name, download_root, bundled_root)
        return True
    except (FileNotFoundError, LocalEntryNotFoundError):
        return False
