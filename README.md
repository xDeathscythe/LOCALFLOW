# LocalFlow

Version: `0.1.19`

LocalFlow is a Windows desktop dictation app that runs locally:

- Speech-to-text: `faster-whisper` with `large-v3` by default
- Whisper model switch: `large-v3-turbo` or `large-v3`, both loaded from `X:\stt-models`
- VAD speech padding: `LOCALFLOW_WHISPER_VAD_SPEECH_PAD_MS=400`
- Whisper model root: `X:\stt-models`
- Whisper language: `sr`
- Output language/script: `Serbian Latin`
- Polish pass: local Ollama model `qwen3:8b`
- Cloud providers: none

## Setup

```powershell
cd "X:\wORK cODEX\localflow"
npm install
npm run setup:python
```

Copy `.env.example` to `.env` if you want to change model names or device settings.

## Run In Development

Terminal 1:

```powershell
npm run dev
```

Terminal 2:

```powershell
$env:VITE_DEV_SERVER_URL="http://127.0.0.1:5173"; npm run desktop
```

## Build

```powershell
npm run build
npm run dist:win
```

## Local Model Notes

Ollama uses `X:\ollama\models` on this machine. The app defaults to the installed `qwen3:8b` model for local cleanup.

Whisper runs through `faster-whisper`; the app uses Python 3.11 from `uv` because Python 3.14 is not a good target for these native audio dependencies on Windows.

Whisper is called with `language=sr`, `task=transcribe`, and a Serbian Latin initial prompt. All raw and polished text is normalized to Serbian Latin before it reaches the UI.

Default Whisper execution is `cuda` + `float16`. Local CUDA/cuDNN runtime DLLs are stored under `X:\wORK cODEX\localflow\runtime\cuda\bin` and injected into the app worker PATH.

The app warms the Whisper model at startup and defaults to `LOCALFLOW_WHISPER_BEAM_SIZE=1` for dictation latency.

Closing the window hides LocalFlow to the system tray. Hold `Ctrl+Shift` to record globally; release both keys to transcribe, copy the polished text, and paste it into the currently focused field.

Runtime files, temporary recordings, and Hugging Face / Whisper model cache are configured under:

```text
X:\wORK cODEX\localflow\runtime
```
