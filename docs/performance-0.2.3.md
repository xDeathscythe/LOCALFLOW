# LocalFlow Windows 0.2.3

Validated on Windows on 4 October 2026. This release retains the native
Rust/Tauri shell and system WebView2, with local PC inference. It reduces actual
work and data movement in the existing architecture. No mobile application,
cloud synchronization service or additional background service was added.

## Changes

- Main, edge, recording, realtime and PDF windows use the same per-profile
  WebView2 directory. The native test observed one browser and one GPU process
  with auxiliary windows active. Distinct explicitly selected profiles have
  separate instance locks; tests cannot redirect into the owner's live window.
- File attachments cross the native boundary as one binary batch. JSON byte
  arrays and the obsolete host upload route were removed. Native validation,
  atomic writes and content identities remain. Asset requests support byte
  ranges, conditional caching and HEAD without reading an entire file.
- A cell edit updates its row, database revision and size ledger inside one
  transaction. Row editors fetch their single row. Related rows are fetched by
  selected IDs, including aliases and recursive rollups. Numeric sorts use
  native SQLite indexes; mixed imported values keep the existing natural sort.
  Unicode substring search caches displayed values and invalidates that cache
  even when an older client writes directly. Conflicts and size limits still
  reject changes atomically.
- Conversations initially read the most recent 100 messages. Earlier messages
  remain available through paging and history search. Writes append or update
  changed messages. Trimming occurs only after a successful durable flush;
  failed writes preserve pending messages and still deliver responses to the UI.
- Note metadata avoids unnecessary tree reads and duplicate serialization.
  Math rendering and embedded database UI load on demand. The editor retains
  its original math schema, commands and Markdown. PDF exports embed KaTeX
  fonts, layout styles and safe radical SVGs without fetching remote assets.
- Cancellation aborts the current STT job and cleanup rather than killing the
  warmed inference process. NumPy initializes before the pipe reader starts:
  real packaged testing reproduced a Windows DLL initialization deadlock in
  the opposite order. EOF wakes both the command and cleanup queues.
- Edge hover only crosses the bridge on entry/exit. Geometry and state update
  only when changed, including monitor/DPI changes. New auxiliary windows
  explicitly receive their initial state after subscribing to events.
- Unused tree components and the Framer Motion dependency were deleted.
  Dependency staging starts fresh. The package includes Playwright's headless
  browser, FFmpeg and Windows library helper; its unused full Chromium copy was
  removed. Immutable runtime/model components are shared between local builds.
  A separate update payload verifies and reuses installed components, including
  the large Codex executable runtime.

## Measurements

These are local fixture measurements, not promises for every machine. Database
results compare 0.2.2 and 0.2.3 with the same 50,000 rows, ten fields and five
runs through the notes service. Times are medians in milliseconds.

| Operation | 0.2.2 | 0.2.3 |
|---|---:|---:|
| Change one cell | 260.55 | 0.98 |
| Numerically sorted page of 100 rows | 74.93 | 7.96 |
| Unicode-compatible substring search | 82.17 | 45.99 |
| Plain page of 100 rows | 3.36 | 4.16 |
| Database metadata | 0.16 | 0.11 |
| Read recent messages from 50,000-message history | 104.90 | 1.45 |
| Save 1,000,000-character rich note | 70.68 | 63.11 |

The conversation read increased JavaScript heap by approximately 0.3 MiB,
compared with 121 MiB before. The ordinary table page gained a small amount of
context/neighbor work; it did not become faster. Large-note saves improved
modestly rather than by orders of magnitude. General computed filters and
sorts still need all relevant source rows, although they fetch only referenced
relation targets. Substring search still scans cached text; it is not full-text
token search and preserves the existing multilingual behavior.

The editor JavaScript chunk fell from 864.5 kB to 602.75 kB; 261.47 kB of math
rendering loads only when used. Native upload of a 10 MB attachment completed in
246.6 ms in the complete integration run, including transfer, hashing and write.
The old 10 MB JSON preparation alone used roughly 290 MiB of JavaScript heap;
that preparation and an entire native upload are different measurement scopes.

The final packaged integration test reached the UI navigation selector in
581.8 ms with a fresh isolated profile and already cached OS/runtime files.
This measures DOM readiness, not a reboot-cold launch or model readiness.
The separate packaged inference check warmed large-v3 on CUDA in 4.60 s,
transcribed its short fixture in 0.49 s and completed the next request after
cancellation in 0.93 s, with exactly one model-ready event. The complete native
test also transcribed that fixture through the desktop bridge.

Two initial audit claims were corrected after tracing actual execution:
0.2.2 already kept reads outside BEGIN IMMEDIATE, and 100 pointer moves did not
produce 100 hover IPC requests. The bridge already deduplicated its boolean
hover state; removing mousemove eliminates redundant local callbacks. Do not
attribute improvements to those incorrect claims.

## Verification and release

The packaged native integration passed all four main themes, focused/unfocused
glass, opaque workspace, expanded/collapsed edge shapes, recording pill corners
and outside bounds, shared browser/GPU processes, note editing and conflict
rejection, math rendering and PDF fonts, binary upload, range/cache requests,
microphone capture, duplex WebRTC, screen capture, actual Unicode paste,
auxiliary-window permissions, real large-v3 inference and graceful shutdown.

The functional test groups, TypeScript/Vite build and Rust checks passed. Added
storage checks cover bounded point writes, Unicode search, numeric and mixed
sorts, older-client cache invalidation, size rollback, conversation failure
recovery above the trimming threshold, worker cancellation and immutable release
components. The updater test proves model reuse, preservation of the old
executable, and rejection of overwrite or corrupted installed components.
The reduced packaged browser passed screenshot and PDF generation.

Reproduce the final native run on an unlocked interactive Windows desktop:

```powershell
node tests/native-desktop.test.cjs release/LocalFlow-0.2.3-Windows-x64/LocalFlow.exe --packaged --glass --inference
node tests/packaged-inference.test.cjs release/LocalFlow-0.2.3-Windows-x64
npm run test:release
npm run test:notes-databases
npm run test:niwa
npm run test:stt
```

The complete portable package remains large because it includes the PC model,
Python packages, CUDA and agent tools. The update folder excludes those shared
components: its final size is 58.6 MB, versus 6.686 GB for the complete package
(decimal units). The previous complete package was 7.143 GB. Neither size should
be confused with idle RAM or startup time.

Android remains a future client: recording and paste are client operations;
inference stays on the Windows PC. Cached notes must remain readable/editable
offline and reconcile when the PC reconnects. This release preserves that
direction without introducing speculative transport or synchronization code.
