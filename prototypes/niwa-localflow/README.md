# LocalFlow / Niwa design preview

Prototype version: **0.1.0**. The installed LocalFlow app is unchanged.

Open `index.html`, or the portable `localflow-niwa.html` produced by `build-preview.py`. The portable file includes every stylesheet, the Manrope font files and the interaction script; it needs no server or network access.

The theme token files and Manrope fonts are copied from `D:\Projects\niwa-ai\assets` (Niwa AI **0.13.1042**). The four theme identifiers are the actual Niwa frontend presets: `dark`, `light`, `static-black`, `static-white`. LocalFlow cards use Niwa's 21px product surface radius, 42px pill actions, and shared panel/control color tokens. The desktop light view uses dark long-form text for legibility. Opaque themes use Niwa's actual `#000000` and `#ffffff` shell backgrounds with no backdrop filter.

Includes interactive appearance controls, recording-state simulation, editable sample transcripts, native clipboard/download, a local preview notebook, sample session history, a simulated Hermes conversation, and a settings view. Recording and AI are explicitly simulations; no microphone is opened and no message leaves the page. Only preview-prefixed localStorage keys are used.

The light glass desktop surfaces have a brighter translucent tint to keep long text readable over the preview wallpaper.

To rebuild and check that the single-file version includes all assets and four themes: `python build-preview.py` from this directory.
