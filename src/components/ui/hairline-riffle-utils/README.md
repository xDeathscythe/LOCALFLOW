# Hairline Riffle

Source: https://github.com/lucasmarkes/hairline/tree/846d9a32dfa0167da57b59ecd236b13457ae5195/packages/hairline/src
MIT, copyright 2026 Lucas Marques. License: ../../../../licenses/hairline.txt.

The core and riffle-geometry.ts are unchanged upstream code. The Riffle geometry
and motion are also identical to the 21st component's bc782244216620434b14736df1d74daed2d05046 source.
Only figures/riffle.ts is adapted for zero to eight real entries, names and activation.
The React wrapper splits the folder children into trays and owns their captions.
The original 700ms lift curve, 40ms stagger, static hit bands, artwork and shared
sleeping/offscreen animation loop are preserved. No other Hairline figures ship.
