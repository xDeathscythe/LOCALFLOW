LocalFlow Niwa tools are adapted from Niwa Code 0.3.1, source checkout
`host` modules, inspected September 29, 2026. These project-owned adaptations
are included in LocalFlow's MIT source release; upstream notices are preserved
in `THIRD_PARTY_NOTICES.md` and `licenses/`.

Transferred modules: private companion memory, SQLite multilingual history,
skill library, browser and readable web extraction, native Windows/macOS computer
adapter, MCP connectors, validated skill learning and shared tool/store helpers.
These files run locally; no Niwa Chat/Code server, profile, account, history or
private memory is connected or imported.

LocalFlow uses the installed Codex app-server for the execution loop, full model
catalog, reasoning, subagents, approvals and realtime V3 WebRTC handoffs. It does
not retain the Hermes runtime or import Niwa Code's Pi model loop, since Codex
already provides the requested voice-to-background-agent execution path.
Web search also uses Codex directly; the duplicated provider configuration and
unused Pi filesystem/delegation wrappers were removed. Bundled procedures are
adapted to the exposed LocalFlow tool names, retaining upstream attribution.

Niwa data lives under LocalFlow's userData/niwa, including an isolated Codex home.
LocalFlow uses Codex-managed browser sign-in from Settings. Codex persists and
refreshes credentials in that isolated home; no other app's login is imported.
API-key accounts can run text tasks; realtime
availability is determined by the account and Codex server.

Upstream third-party packages retain their npm licenses. Native adapter scripts
are ordinary files in the portable Windows runtime.
