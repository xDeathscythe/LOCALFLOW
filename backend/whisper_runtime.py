"""Warm the selected Whisper model without changing its size or downloading it."""
def load_profile(requested, device, compute_type, download_root, bundled_root, progress):
    import numpy as np
    from faster_whisper import WhisperModel
    from faster_whisper.vad import get_speech_timestamps
    from model_downloads import whisper_path

    source = whisper_path(requested, download_root, bundled_root)
    progress(f"Preparing Whisper {requested} on {device.upper()}")
    model = WhisperModel(source, device=device, compute_type=compute_type, local_files_only=True)
    silence = np.zeros(16000, dtype=np.float32)
    segments, _ = model.transcribe(silence, language=None, vad_filter=False,
                                  beam_size=1, best_of=1, temperature=0, max_new_tokens=1,
                                  no_speech_threshold=None, condition_on_previous_text=False)
    for _ in segments:
        pass
    get_speech_timestamps(silence)
    return model, {"model": requested, "device": model.model.device,
                   "computeType": model.model.compute_type}
