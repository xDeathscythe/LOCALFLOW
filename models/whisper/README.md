# Bundled Whisper models

Run `npm run models:stage` before creating an offline build. It validates the two CTranslate2 model snapshots used by LocalFlow in this directory:

- `large-v3`
- `large-v3-turbo`

The model binaries stay outside Git because they are about 4.4 GB together. The offline packaging command includes them as application resources.

Each folder needs `config.json`, `model.bin`, `preprocessor_config.json`,
`tokenizer.json` and `vocabulary.json`. Obtain the CTranslate2 snapshots from the
faster-whisper model publisher, respecting their licenses. If they already exist
elsewhere, `scripts/stage-whisper-models.ps1 -SourceRoot <directory>` copies and
validates this folder layout. Source development can instead download models on
first use into `runtime/models/whisper`; that cache is not the offline bundle layout.
