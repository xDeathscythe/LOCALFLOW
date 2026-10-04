# LocalFlow

**0.2.0 · Windows x64 · MIT**

Local dictation, rich notes and the Niwa voice agent. The desktop shell uses
Rust/Tauri 2 and Windows WebView2. Electron is no longer an application dependency.
The React/Tiptap editor is retained; local AI runs in separate feature processes.

Whisper large-v3 runs on the PC, with NVIDIA CUDA when supported and CPU otherwise.
Hold the configured dictation shortcut, speak, and release to insert the transcript
in the foreground application. Notes, databases, page history and conversation
history persist locally. Optional Codex cleanup, realtime voice, browser use,
computer tools, MCP connectors and voice-output engines remain available.

## Windows package

Open `release/LocalFlow-0.2.0-Windows-x64/LocalFlow.exe`. Keep the whole directory
together: it contains Python, Node, Codex, CUDA/cuDNN, large-v3 and browser tools.
The executable alone is not the complete application. Microsoft WebView2 and the
Visual C++ x64 runtime are required; the latter is included under
`runtime/prerequisites`. No local Python or Node installation is needed.

Data stays in `%APPDATA%/localflow`. On the first upgrade, the old Notes files are
migrated transactionally to `notes/workspace.sqlite`; the old files remain as a
recovery snapshot. Subsequent editing writes SQLite. Use Markdown export for
external editing rather than editing those retired files.

Optional STT/TTS engines download only after selection and confirmation. Agent
and realtime services require the account and internet access used by those
services. A mobile client is not included in this release.

## Develop

Windows 10/11 x64, Node **24.12.x**, Rust, Microsoft C++ Build Tools and WebView2:

```powershell
npm ci
Copy-Item .env.example .env
npm run setup:python
npm run runtime:stage
npm run models:stage
npm run desktop:build
npm start
```

`npm run desktop:dev` runs the native development shell and Vite. `npm run dist:win`
builds a self-contained portable Windows directory from the staged runtimes.
`npm run dist:offline` additionally creates a ZIP64 archive. Stage prerequisites
and agent/browser tools with `npm run runtime:prerequisites` and
`npm run agent:stage` before packaging. Optional voice-cloning payloads and private
voice references are excluded from the standard package.

## Verify

```powershell
npm run test:native
npm run test:native:inference
npm run test:notes-editing
npm run test:notes-databases
npm run test:workspace
npm run test:niwa
npm run test:niwa-screen
npm run test:duplex
npm run test:shortcuts
npm run test:latency
npm run test:runtime
npm run test:stt
npm run test:performance
```

Native integration checks use an isolated profile, synthetic audio, actual
WebView2, native clipboard/input, PDF, capture, attachments, edge/overlay windows
and graceful shutdown. The inference variant loads the real PC large-v3 model.
See [architecture, measurements and Android direction](docs/windows-rework-0.2.0.md)
and [third-party notices](THIRD_PARTY_NOTICES.md).
