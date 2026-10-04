# Windows glass fix 0.2.1

The native rework selected `ACCENT_ENABLE_BLURBEHIND` with a zero tint. This
did not reproduce the previous working Windows acrylic material. Version 0.2.1
restores `ACCENT_ENABLE_ACRYLICBLURBEHIND`, zero accent flags and the minimal
nonzero tint alpha used by the previous shell. Static themes disable the effect.
No Python glass process, additional renderer or new dependency is introduced.
The native composition call now reports failure instead of silently accepting it.

Showing or restoring the main window also focuses its WebView, so keyboard input
reaches the editor after an auxiliary window has held focus.

`npm run test:native:glass` checks composed Windows desktop pixels, rather than
only CSS colors. An owned backdrop changes from red to blue behind the actual
WebView2 window. Both glass themes reveal the change and remain transparent when
focus moves to a test window. The workspace stays opaque. Pure black and pure
white remain opaque across backdrop and focus changes. Fixtures and profiles are
isolated; private documents are not used by this check.
