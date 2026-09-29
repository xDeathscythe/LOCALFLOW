# Third-party notices

LocalFlow's original code is released under the [MIT license](LICENSE). This
does not replace the licenses of dependencies, fonts, model weights or voices.

## Adapted Niwa modules and skills

The local agent modules were adapted from the project owner's Niwa Code 0.3.1.
See [provenance](electron/niwa/PROVENANCE.md). Its upstream notices credit
[Hermes Agent](https://github.com/NousResearch/hermes-agent) and
[T3 Code](https://github.com/pingdotgg/t3code) for bounded adapted functionality.
Their MIT notices are preserved in [licenses](licenses/).

The bundled systematic-debugging, simplify-code and grounded-research skills
retain individual source URLs in `electron/niwa/profiles/niwa/skills.json`.
They adapt Hermes Agent revision `68518c1f9bca11d9f5dbdf59ecf7e024cce057ba`.
Systematic debugging also credits [obra/superpowers](https://github.com/obra/superpowers).
The upstream MIT notices are included. The remaining bundled skills are Niwa originals.
Neither Hermes' runtime nor Niwa Code's Pi execution loop is included.

## Manrope

The Manrope fonts in `src/assets/fonts` and the design prototype retain the
[SIL Open Font License 1.1](licenses/manrope-OFL.txt), copyright 2018 The Manrope
Project Authors. They are not relicensed under MIT.

## Dependencies and optional model downloads

JavaScript dependency versions are pinned in `package-lock.json`; their licenses
remain in the installed packages. Python dependencies are listed in
`backend/requirements.txt`, `tts/requirements` and `build/windows-mcp-requirements.txt`.
Electron, Chromium, Codex, Windows MCP and local inference engines retain their
respective upstream notices. Preserve these when distributing a compiled application.

Model weights, reference recordings and third-party executables are not part of
this source release. Download and redistribution terms belong to their publishers;
in particular, do not treat the XTTS-v2 model as MIT-licensed. `tts/manifest.json`
records model sources and checksums, not a grant to redistribute them. Supply your
own authorized voice references when preparing a full offline distribution.
