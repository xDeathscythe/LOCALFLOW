# Shaped Windows panels 0.2.2

The edge panel and recording pill inherited the native window's default shadow.
On Windows 11, that setting adds a border and rounded rectangular frame behind
the HTML shape. Transparent CSS did not remove this native surface.

Both windows now disable the native shadow with Tauri's `shadow(false)`.
Their SVG and CSS shapes, buttons, positions and hover behavior are retained.
The main window keeps its acrylic material. No dependency or background process
is added.

The desktop material check reproduces the old failure: a pure red backdrop
became `233,24,24` in a supposedly empty part of the edge window. It now checks
empty corners and the area outside each panel against red and blue desktop
backdrops. Edge checks cover expanded and collapsed states in all four themes;
the recording pill is checked separately. Screenshots include the composed
desktop, so a transparent WebView screenshot alone cannot pass this check.
The main backdrop follows the visible DWM frame bounds, excluding Windows'
invisible resize border. Small panel fixtures reserve only four pixels outside
the shape to detect an unwanted native shadow.

Run `npm run test:native:glass` to check the main acrylic window, shaped panels,
native note persistence, audio, clipboard, navigation and graceful exit together.
