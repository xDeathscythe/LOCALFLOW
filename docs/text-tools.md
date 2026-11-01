# Text tools (Windows 0.3.14)

In LocalFlow, select text and right-click. **LocalFlow Grammar check** and **Send to LocalFlow Scrub board** appear inside the existing native WebView2 menu alongside Copy. There is no companion menu window.

In other applications, use **Ctrl + right-click** on selected text for the native LocalFlow action menu. Ordinary right-click remains owned by the source application. Windows has no shared extension point for arbitrary text menus across third-party applications. The external selection requires Windows UI Automation TextPattern support; password controls are excluded.

**Select Copy**, or **F2 + F3** held together, captures the display under the pointer and immediately recognizes the whole screen locally with Windows OCR. Drag to select words and lines, then press **Ctrl+C** or **Copy**. **Ctrl+A** selects all recognized text. **Esc** exits, including while recognition runs, without changing the clipboard. There is no image cropping or per-selection model request. The language picker shows installed Windows OCR languages; recognition coverage depends on those packages. Protected capture surfaces may appear blank.

The **Scrub board** is a page in the main window using the Notes editor. Drafts stay in memory and clear when you leave the page. **Save note**, at the bottom right, saves a copy in Notes. Sending more text to an open board appends it. **Reshape** applies your request; **Undo rewrite** restores the previous draft.

Grammar and rewriting use your LocalFlow ChatGPT account with `gpt-6.1-sol`, medium reasoning and fast service. Only the selected text is sent. Failed requests leave the clipboard unchanged. Requests have no tools and use ephemeral threads. Screen recognition does not require ChatGPT and does not send screenshots to it.

Checks: `node tests/text-tools.test.cjs`, `npm run test:shortcuts`, and `node tests/native-desktop.test.cjs src-tauri/target/release/localflow-desktop.exe --text-tools`.
