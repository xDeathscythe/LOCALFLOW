# LocalFlow

**Version 0.1.117 · Windows desktop · MIT licensed**

Local dictation, notes and a realtime Niwa voice agent in an Electron desktop app.
Speak into another application, keep transcripts in notes, or talk to an agent
that can use browser, computer and MCP tools while working in the background.

## Features

- Local speech recognition with bundled Whisper large-v3. Optional speech models
  download only after selection and confirmation in Settings.
- Optional transcript cleanup using a selectable Codex text model or Live 1.
- Niwa realtime duplex voice with a separate Codex workspace, conversation history,
  memory, skills and subagents. No Niwa Chat account or server is required.
- Hold-to-talk: releasing Niwa's shortcut closes the microphone while replies and
  background work continue. Dictation can then use the microphone independently.
- Screen inspection, native computer tools, Playwright browser use and MCP connectors.
- Edge panel with Niwa, microphone and Notes; optional auto-hide and four themes.
- Local voice output through Piper, XTTS or OmniVoice; optional external xVASynth.

## Install on Windows

The full offline package consists of **LocalFlow Offline Setup <version>.exe** and its accompanying **localflow-<version>-x64.nsis.7z** archive. Keep both files in the same folder, run the installer and leave **Run LocalFlow** selected at the end. The archive is verified before installation and is never downloaded by setup.

The installer includes only Whisper large-v3 weights (3.09 GB), Microsoft Visual C++
x64 runtime, CUDA/cuDNN libraries, Python, the Codex runtime, Chromium and Windows computer tools.
Large is the default on both NVIDIA GPU and CPU; LocalFlow never selects a smaller model automatically.
Other STT and local voice-output models download only after selection and confirmation.
Downloads are stored in writable user folders and reused on later launches.
Hold **Ctrl + Shift**, speak, then release to paste the transcript into the active application.
Dictation starts with automatic language detection, automatic NVIDIA GPU/CPU selection and cleanup disabled.
CTranslate2 selects supported compute precision; Settings shows the actual device.
Default dictation needs no account, Python installation or first-run model download.
Setup validates and warms Large offline. Each app launch warms it again and retains it in memory;
wait for "Whisper ready" before recording. Large on CPU can be slow. This backend does not
accelerate AMD/Intel GPUs.

Setup requests administrator access and installs for all users. The default dark
and light themes include native transparency. When Windhawk's Translucent Windows
mod is installed, setup adds the installed LocalFlow.exe path to its custom
exclusions without replacing existing rules. No manual registry changes are needed.
Preparation errors stop setup and are recorded in `setup.log` in the install folder.
The Visual C++ installation log is `vc-runtime.log`; setup reports when Windows
needs a restart to finish installing the runtime.

Open **Settings → Connect with Codex** to sign in and use the agent. Cloud agent
and realtime voice features require internet and an account with access. No
separate Codex desktop installation is needed. Extra speech models download when
selected and are stored in your writable user-data directory. Optional voice
cloning engines require their own models and your authorized reference audio.

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

The example configuration uses `auto` for the device and compute precision.
Explicit `LOCALFLOW_WHISPER_DEVICE=cpu` or `cuda` overrides automatic selection.
Set `LOCALFLOW_CUDA_BIN` if the DLLs
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

Run `npm run dist:win` to build the public installer and accompanying archive in
`release/windows/nsis-web`. The standard package includes Whisper Large, GPU libraries
and the agent tools. Other model weights and personal voice recordings are excluded.

Run `npm run package:offline` for `release/win-unpacked/LocalFlow.exe`, or
`npm run dist:offline` for the full installer and its `.7z` payload in `release/nsis-web`.
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


### Projects, chats and Markdown notes

Agents keeps Niwa's main conversation separate from project chats. Add a project with the folder picker, add nested workspace folders, and use each folder's + button for a new chat. Selecting a folder opens its most recent chat. Each chat retains its Codex thread, transcript, diff, model, reasoning and permissions; switching is disabled during a task or voice session.

Notes supports a visual block editor and Markdown source, headings 1–6, paragraphs, bold/italic/strikethrough, nested lists, checklists, quotes, code, links, dividers and editable tables. Autosave writes UTF-8 `.md` files to `%APPDATA%/localflow/notes/pages`; `index.json` stores folder hierarchy and titles. Existing browser notes import once with a retained `legacy-backup.json`. Deleted pages remain on disk with an archived index. Conflicting edits preserve the unsaved draft and offer reload or save-as-copy.

Niwa uses the same `notes_list`, `notes_read`, `notes_create` and `notes_update` tools to turn typed or spoken requests into structured notes. Read-only sessions cannot write notes. Agent responses support Markdown/code rendering, copy and Save to Notes; changes show line numbers, file filtering, copyable patches and unified/split views.

Validate with `npm run test:workspace` after `npm run build`.

### Build storage and performance checks

`npm run dist:win` builds a clean UI into `runtime/release-ui` and packages only that output. Development builds retain old chunks in `dist` so an already open app can finish loading its assets. The public package includes Windows MCP and excludes bundled TTS weights; `npm run package:offline` stages optional voice engines separately in `runtime/distribution-full`.

`npm run clean:builds` previews obsolete build artifacts and duplicate staging folders. After validating the current installer and writing its `SHA256SUMS-<version>.txt`, run `npm run clean:builds -- -Apply` to remove those artifacts. The script retains two verified releases per profile, checks both offline installer and payload hashes, and skips targets used by running processes. Notes, model sources and development voice runtimes are retained.

`node tests/performance-data.test.mjs` checks ordered worker saves, revision conflicts, incremental transcript persistence and database query timings. Conversations now persist metadata and changed messages in the existing `niwa/history.sqlite` database; old JSON transcripts are imported once and retained as recovery copies. Back up the whole user-data directory with the app closed to include current conversations. Chat history loads in pages of 100 messages. Large diffs render visible lines and provide full-patch copy and search.

Database queries, formulas, rollups, sorting and filtering run in the notes worker. The UI receives pages of 100 rows, while revision-checked edits merge into the complete stored database. Relation choices load when their editor opens; CSV export includes the complete filtered view. Calendar and timeline queries filter the selected month before pagination. `node tests/database-pagination.test.mjs` verifies that edits to a loaded page preserve unseen rows.

Local TTS keeps one selected model loaded across recording turns. Starting dictation interrupts speech. Piper stops at a chunk boundary; XTTS and OmniVoice stop at a model forward boundary without unloading weights. External xVASynth requests may still finish silently. Only the TTS worker unloads after five idle minutes, so its next reply needs a cold model load. VTT stays warm. Generated temporary WAVs are limited to 100 files, 256 MiB and seven days (the current result is protected); reference audio and exported files are excluded. XTTS uses Coqui's native cloned-voice cache under the voice-output folder's sibling `voice-cache/xtts`, keyed by reference content, model metadata/configuration and Coqui version.

The source startup launcher runs Electron directly, without npm's extra processes. Notes loads on first use and stays mounted afterward so autosave keeps working. Recording clocks update independently of the main React tree. The notch uses a 31 px canvas on all displays, 4 px control margins and a `#abf0d1` selector.

The Notes page menu supports searchable actions, page links/content copy, recoverable trash, up to 20 recent page revisions within an 8 MB history budget, persisted page locking and appearance, presentation, a heading index, imports/exports, and reviewed AI suggestions/translations. Pages are always stored locally. Notion cloud collaboration, comment notifications and external workspace connections are not provided by this local menu.

Startup and recording checks: `electron tests/startup.test.cjs`, `electron tests/recording-performance.test.cjs`, `node tests/startup-paths.test.cjs`. The startup smoke uses an isolated profile and substitutes GPU/hotkey/Codex services; its timings do not measure model loading.

Validate TTS lifecycle with `node tests/voice-output.test.cjs` and `node scripts/run-python.cjs tests/voice-output-session.test.py`. With the optional CUDA XTTS runtime installed, run `runtime/tts/xtts/.venv/Scripts/python.exe -B tests/xtts-cache.test.py` to verify real conditioning reuse and reference invalidation. These tests do not play audio.
