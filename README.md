# LocalFlow

**0.3.1 · Windows x64 · MIT**

Local dictation, rich notes and the Niwa voice agent. The desktop shell uses
Rust/Tauri 2 and Windows WebView2. Electron is no longer an application dependency.
The React/Tiptap editor is retained; local AI runs in separate feature processes.

Whisper large-v3 runs on the PC, with NVIDIA CUDA when supported and CPU otherwise.
Hold the configured dictation shortcut, speak, and release to insert the transcript
in the foreground application. Notes, databases, page history and conversation
history persist locally. Optional Codex cleanup, realtime voice, browser use,
computer tools, MCP connectors and voice-output engines remain available.

## Windows package

Open `release/LocalFlow-0.3.1-Windows-x64/LocalFlow.exe`. Keep the whole directory
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

## Meetings and connected devices

The side notch opens the Meetings recorder. Choose a call application (or all
computer audio), confirm recording, and LocalFlow saves microphone and remote
audio in independent recoverable chunks. Transcripts are processed locally and
saved in **Notes / Meetings**. Codex can summarize transcript text into a title,
key points, decisions, actions and open questions; failed processing can be retried.
Meeting notes open with an action checklist and topic-based summary. Numbered
sources open the corresponding passage in the separate, searchable full transcript.
The original editable note remains available under **Edit note**.
Use headphones when the microphone does not provide echo cancellation.

Optional [browser call detection](extensions/meeting-detection/README.md) offers
recording for supported browser WebRTC calls after pairing the bundled extension.
Native app audio activity alone does not trigger recording or an automatic offer.
The recorder can be started manually for Zoom, WhatsApp, Viber and other apps.
Process audio capture requires Windows build 20348 or later; all-computer loopback
is available when process capture is unsupported. Browser application capture
can include other tabs.

Google sign-in and Calendar use a separate LocalFlow account service. The desktop
contains account settings and the remote Notes host; the deployable service is in
`services/account`. Production Clerk/Google and managed tunnel credentials must be
provisioned before sign-in and access over the internet can work. These credentials
are never bundled in the desktop package. A mobile app is outside this release.
See [account setup](docs/account-and-remote-setup.md) and
[meeting release verification](docs/meetings-0.3.1.md).

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

Each build also creates a smaller `LocalFlow-<version>-Windows-x64-update` folder.
After quitting the installed application, run its `scripts/update-localflow.ps1`
with `-From` pointing to the previous complete release directory. It verifies
installed runtime/model hashes and creates a new release beside the old one.
Use the complete package if those components differ; an update never overwrites
an existing release. Builds share immutable runtime files locally through hard
links; changing a build source cannot change an already packaged runtime.

## Verify

```powershell
npm run test:native
npm run test:native:meetings
npm run test:meetings
npm run test:account
npm run test:native:inference
npm run test:native:glass
npm run test:native -- --notion-media
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
npm run test:release
```

Native integration checks use an isolated profile, synthetic audio, actual
WebView2, native clipboard/input, PDF, capture, attachments, edge/overlay windows
and graceful shutdown. The inference variant loads the real PC large-v3 model.
See [architecture, measurements and Android direction](docs/windows-rework-0.2.0.md),
[the Windows glass fix](docs/windows-glass-0.2.1.md),
[shaped Windows panels](docs/windows-edge-0.2.2.md),
[0.2.3 performance results](docs/performance-0.2.3.md)
and [third-party notices](THIRD_PARTY_NOTICES.md).
