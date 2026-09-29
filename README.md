# LocalFlow

**Version 0.1.77 · Windows desktop · MIT licensed**

Local dictation, notes and a realtime Niwa voice agent in an Electron desktop app.
Speak into another application, keep transcripts in notes, or talk to an agent
that can use browser, computer and MCP tools while working in the background.

## Features

- Local speech recognition with faster-whisper or ONNX ASR: Whisper large-v3 /
  large-v3-turbo, NVIDIA Parakeet TDT 0.6B V3 and Canary 1B V2.
- Optional transcript cleanup using a selectable Codex text model or Live 1.
- Niwa realtime duplex voice with a separate Codex workspace, conversation history,
  memory, skills and subagents. No Niwa Chat account or server is required.
- Hold-to-talk: releasing Niwa's shortcut closes the microphone while replies and
  background work continue. Dictation can then use the microphone independently.
- Screen inspection, native computer tools, Playwright browser use and MCP connectors.
- Edge panel with Niwa, microphone and Notes; optional auto-hide and four themes.
- Local voice output through Piper, XTTS or OmniVoice; optional external xVASynth.

## Run from source

Use Windows 10/11 x64, Git, Node.js 24 with npm, and `uv` on PATH. Model downloads
require network access and several gigabytes of disk space. CPU transcription is
supported; CUDA requires compatible NVIDIA hardware and CUDA/cuDNN libraries.

```powershell
git clone https://github.com/xDeathscythe/LOCALFLOW.git
cd LOCALFLOW
npm ci
npm run setup:python
Copy-Item .env.example .env
npm run build
npm start
```

The example configuration uses CPU/int8 so it does not require NVIDIA libraries.
For GPU transcription, set `LOCALFLOW_WHISPER_DEVICE=cuda` and
`LOCALFLOW_WHISPER_COMPUTE_TYPE=float16`. Set `LOCALFLOW_CUDA_BIN` if the DLLs
are outside `runtime/cuda/bin`. Model and cache paths otherwise resolve automatically.
The first use downloads missing STT weights; subsequent uses reuse local files.

For frontend development, run `npm run dev` in one terminal, and in another:

```powershell
$env:VITE_DEV_SERVER_URL = "http://127.0.0.1:5173"
npm run desktop
```

Local transcription needs no cloud login when cleanup is disabled. For cleanup
and Niwa, use **Settings → Connect with Codex**. The bundled Codex runtime owns
sign-in and credential refresh in LocalFlow's separate user-data directory.
You do not need the Codex desktop app. Model and realtime access depend on the
signed-in account and service availability; Live 1 is not a local model.

## Voice, cleanup and shortcuts

Quick dictation defaults to **Ctrl + Shift**. Niwa uses **Ctrl + Caps Lock**:
hold to capture audio, release to close the microphone, and choose **End voice**
to close the conversation. Shortcuts can be changed in Settings. Enter sends a
typed message; Shift + Enter inserts a line break. Closing the main window hides
LocalFlow to the tray.

**Settings → Cleanup model & Live1 voice** selects the cleanup model. Text models
use the Codex text connection. Live 1 uses a separate ephemeral WebRTC connection
with synthetic silence, without capturing the microphone or playing audio.
Cancelling cleanup closes that connection without ending Niwa's conversation.

Supported v3 voices are **Juniper** (default), **Maple**, **Spruce**, **Ember**,
**Vale**, **Breeze**, **Arbor**, **Sol** and **Cove**. Changes apply to the next call.
Typed agent messages use the selected backing Codex model; duplex voice uses Live 1.

Whisper offers Serbian, English and auto-detection. Parakeet detects its supported
languages automatically. Canary uses Croatian for the Serbian selection because
it has no Serbian token; its auto selection currently defaults to English.

## Local voices and offline installers

Optional voice engines are prepared with `npm run setup:tts`. The pinned sources,
versions and checksums are in `tts/manifest.json`. Voice-cloning references are
**not included**: supply your own authorized WAV files and update their checksums
before setup. See [voice reference setup](assets/tts/README.md).

A complete offline Windows installer also needs these build-machine payloads:

1. Both CTranslate2 Whisper models in `models/whisper/large-v3` and
   `models/whisper/large-v3-turbo`. See [model layout](models/whisper/README.md).
2. Portable transcription Python/packages: `npm run runtime:stage`.
3. Prepared TTS environments and references: `npm run setup:tts`.
4. NVIDIA runtime DLLs in `runtime/cuda/bin` when distributing GPU support.

Then run `npm run package:offline` for `release/win-unpacked/LocalFlow.exe`, or
`npm run dist:win` for the installer and its `.7z` payload in `release/nsis-web`.
Distribute both installer files together. Staging verifies local payloads;
the end-user installer does not download missing models. xVASynth remains external.
Review upstream model and runtime redistribution terms before distributing binaries.

## Data and permissions

Dictation audio is transcribed locally. Enabling cleanup sends transcript text to
the selected cloud model. Realtime voice sends audio to the realtime service;
screen-inspection requests can send captured screen content to the agent's model.
Browser and computer tools act with the access configured for Niwa.

Development caches and temporary recordings live in `runtime/`. Installed app data,
notes, settings, Niwa history and managed Codex credentials live in Electron's
LocalFlow user-data directory (normally `%APPDATA%/localflow`). None of those are
included in this repository. LocalFlow does not import Niwa Chat/Code private memory.

## Development checks

Build and run focused tests without cloud calls:

```powershell
npm run build
npm run test:notes
npm run test:runtime
npm run test:cleanup
npm run test:cleanup-auth
npm run test:niwa
npm run test:niwa-voice
npm run test:niwa-screen
node tests/duplex-cleanup.test.cjs
node tests/duplex-session.test.cjs
```

Python tests need `npm run setup:python`; Electron UI tests need the built frontend.
TTS, standalone-package and native hardware tests require their corresponding
local payloads. Tests named `*-live*` use real services and an authenticated account;
run them deliberately. They are not part of the checks above.

Source is organized in `src/` (React UI), `electron/` (desktop and agent),
`backend/` (Python audio workers), `scripts/` and `build/` (distribution), and
`tests/`. `prototypes/` and `docs/` preserve earlier design experiments and renders;
they do not represent the current running application.

Contributions are welcome through issues and pull requests. Keep changes focused,
include reproduction steps and relevant test results, and never include credentials,
personal recordings, conversation history or model weights.

## License

Original LocalFlow source is [MIT licensed](LICENSE). Fonts and adapted components
retain their [third-party notices](THIRD_PARTY_NOTICES.md). Cloud service access,
model weights and voice recordings are separate from this source-code license.
