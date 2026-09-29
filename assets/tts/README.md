# Voice reference files

Private voice-cloning recordings are intentionally excluded from Git. The source
app can run dictation and realtime voice without preparing these local TTS engines.
The current full TTS installer expects both references listed in `tts/manifest.json`.

To prepare your own offline voice payload:

1. Put WAV recordings you are authorized to use in `assets/tts/refs/`, using the
   filenames listed under `references` in the manifest. These filenames are kept
   for compatibility with the runtime defaults; no recordings are distributed.
2. Replace each reference's `sha256` in `tts/manifest.json` with your file's hash:
   `Get-FileHash assets/tts/refs/your-file.wav -Algorithm SHA256`.
3. Run `npm run setup:tts`, then `npm run verify:tts`.

Do not commit recordings or your personal reference configuration. Model download
terms are defined by the respective publishers, not LocalFlow's MIT license.
