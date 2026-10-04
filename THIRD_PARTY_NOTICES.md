# Third-party notices

LocalFlow's original code is released under the [MIT license](LICENSE). This
does not replace the licenses of dependencies, fonts, model weights or voices.

## Adapted Niwa modules and skills

The local agent modules were adapted from the project owner's Niwa Code 0.3.1.
See [provenance](host/niwa/PROVENANCE.md). Its upstream notices credit
[Hermes Agent](https://github.com/NousResearch/hermes-agent) and
[T3 Code](https://github.com/pingdotgg/t3code) for bounded adapted functionality.
Their MIT notices are preserved in [licenses](licenses/).

The bundled systematic-debugging, simplify-code and grounded-research skills
retain individual source URLs in `host/niwa/profiles/niwa/skills.json`.
They adapt Hermes Agent revision `68518c1f9bca11d9f5dbdf59ecf7e024cce057ba`.
Systematic debugging also credits [obra/superpowers](https://github.com/obra/superpowers).
The upstream MIT notices are included. The remaining bundled skills are Niwa originals.
Neither Hermes' runtime nor Niwa Code's Pi execution loop is included.

## Manrope

The Manrope fonts in `src/assets/fonts` and the design prototype retain the
[SIL Open Font License 1.1](licenses/manrope-OFL.txt), copyright 2018 The Manrope
Project Authors. They are not relicensed under MIT.

## Dependencies and optional model downloads

JavaScript dependency versions are pinned in `package-lock.json`; Rust versions
are pinned in `src-tauri/Cargo.lock`. The portable package preserves collected
dependency notices under `licenses/dependencies`, including compiled UI and Rust
components. Installed Node/Python packages retain their own notices. Node 24.12.0's
complete upstream notice is in `licenses/node-24.12.0-LICENSE.txt`.
Python dependencies are listed in `backend/requirements.txt`, `tts/requirements`
and `build/windows-mcp-requirements.txt`. Codex, Windows MCP and local inference
engines retain their upstream terms. The system WebView2 runtime is provided by
Microsoft; Electron is not included.

Model weights, reference recordings and third-party executables are not part of
this source release. Download and redistribution terms belong to their publishers;
in particular, do not treat the XTTS-v2 model as MIT-licensed. `tts/manifest.json`
records model sources and checksums, not a grant to redistribute them. Supply your
own authorized voice references when preparing a full offline distribution.

## Portable Windows components

NVIDIA CUDA 12 and cuDNN 9 runtime libraries retain NVIDIA's proprietary terms;
they are not covered by LocalFlow's MIT license. See the
[CUDA license](https://docs.nvidia.com/cuda/eula/index.html) and
[cuDNN license](https://docs.nvidia.com/deeplearning/cudnn/backend/latest/reference/eula.html).
The graphics driver is provided by NVIDIA and must already be installed on the target PC.

The standard Windows package includes Whisper large-v3 in CTranslate2 format from
[SYSTRAN](https://huggingface.co/Systran/faster-whisper-large-v3), based on
[OpenAI Whisper](https://github.com/openai/whisper), under MIT. Other models are
optional downloads and retain their publishers' terms.

The official Microsoft Visual C++ x64 Redistributable is included under Microsoft's
terms. Its Microsoft signature is verified before packaging. Source, version and
SHA-256 are recorded in `runtime/prerequisites/vc-runtime.json`; see
[Microsoft's redistribution guidance](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files).

Piper 1.4.2 runs as a separate Python process under GPL-3.0-or-later. Its license
is included in the packaged `piper_tts-1.4.2.dist-info/licenses/COPYING`.
The corresponding source and build instructions are available at
[Piper v1.4.2](https://github.com/OHF-voice/piper1-gpl/tree/v1.4.2), including its
eSpeak NG build dependency. Source archive:
https://github.com/OHF-voice/piper1-gpl/archive/refs/tags/v1.4.2.tar.gz.

The optional en_US-kristin-medium voice was trained by Bryce Beattie using
LibriVox recordings. The publisher's [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/kristin/medium/MODEL_CARD)
identifies the training dataset as public domain. Personal voice references and
XTTS/OmniVoice weights are excluded from the standard package.
