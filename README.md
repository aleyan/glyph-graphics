# glyph-graphics

A focused TypeScript implementation of Alex Harri Jónsson's shape-aware ASCII
renderer, with an optional Three.js tilemap renderer.

Instead of ordering characters by darkness, the Harri algorithm measures the
ink in six regions of each glyph and compares that shape vector with the same
six regions in an image cell. Ten external samples provide edge context for
directional contrast. Diagonals, curves, and asymmetric glyphs therefore remain
meaningful instead of collapsing into a brightness ramp.

The alternate algorithms, preprocessing experiments, evaluation framework,
fixture images, debug frontend, and generated reports live in the sibling
`glyph-graphics-experiments` repository.

## Install

```bash
bun add glyph-graphics
```

Three.js is not installed by the core package. Add it only when using the
renderer:

```bash
bun add three
```

The root import has no runtime dependency on Three.js. The adapter is isolated
behind `glyph-graphics/three`, and `three` is declared as an optional peer.

## Convert an image

`buildAlexHarriAlphabet` measures a font using the published 48×64 cell, six
internal samples, ten external samples, and 13.5-pixel sample radius.

```ts
import {
  alexHarriAlgorithm,
  buildAlexHarriAlphabet,
  charsets,
  toText,
} from "glyph-graphics";

await document.fonts.load("64px 'Fira Code'");

const alphabet = buildAlexHarriAlphabet({
  font: { family: "Fira Code", size: 64 },
  chars: charsets.SHAPE_ASCII,
});

const canvas = document.createElement("canvas");
canvas.width = image.width;
canvas.height = image.height;
const context = canvas.getContext("2d")!;
context.drawImage(image, 0, 0);

const source = context.getImageData(0, 0, canvas.width, canvas.height);
const ascii = alexHarriAlgorithm.convert(source, alphabet, {
  cols: 100,
  quality: 5,
  globalCrunch: 2,
  directionalCrunch: 3,
  color: true,
});

console.log(toText(ascii));
```

The supplied alphabet must contain fewer than 50 unique printable ASCII
characters. `charsets.SHAPE_ASCII` is a portable 47-character default made only
from letters, numbers, punctuation, and symbols—no box drawing, block, Braille,
or other specialty drawing characters.

Input may be an `ImageData` object, a decoded RGBA buffer with the same shape,
or a WebGL readback. Use `flipY: true` for bottom-up pixel buffers. Set `rows`
for an exact output grid or omit it to preserve the image and glyph aspects.

### Headless font measurement

Server runtimes can inject any structurally compatible canvas:

```ts
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { buildAlexHarriAlphabet, charsets } from "glyph-graphics";

GlobalFonts.registerFromPath("./FiraCode-Regular.ttf", "Fira Code");

const alphabet = buildAlexHarriAlphabet({
  font: { family: "Fira Code", size: 64 },
  chars: charsets.SHAPE_ASCII,
  canvas: (width, height) => createCanvas(width, height),
});
```

### Reuse and serialization

Alphabet measurement is the expensive part. Build it once and reuse it for
still images or every frame of a video. Alphabets are plain serializable data:

```ts
import {
  deserializeAlphabet,
  serializeAlphabet,
} from "glyph-graphics";

const saved = serializeAlphabet(alphabet);
const restored = deserializeAlphabet(saved);
```

## Render with Three.js

The Three.js adapter packs every glyph into an atlas and renders the entire
ASCII grid on one textured quad:

```ts
import { AsciiTilemap } from "glyph-graphics/three";

const tilemap = new AsciiTilemap(alphabet, {
  background: 0x000000,
  ink: 0xffffff,
  useColor: true,
});

scene.add(tilemap.mesh);
tilemap.update(ascii);
renderer.render(scene, camera);

// Later:
tilemap.setBackground(0x101014);
tilemap.setInk(0xf5f1e8);
tilemap.setUseColor(false);

// On teardown:
tilemap.dispose();
```

Importing `glyph-graphics/three` exposes:

| Export | Purpose |
| --- | --- |
| `AsciiTilemap` | One-quad renderer for an `AsciiFrame` |
| `buildGlyphAtlas` | Rasterize an alphabet into an atlas |
| `packGlyphIndices` | Encode per-cell glyph indices |
| `packColors` | Encode optional per-cell RGB values |
| `VERTEX_SHADER` / `FRAGMENT_SHADER` | Shader sources for custom integrations |

## Core API

| Export | Purpose |
| --- | --- |
| `buildAlexHarriAlphabet` | Measure glyphs with the exact published geometry |
| `alexHarriAlgorithm` | Convert an RGBA frame with the exact Harri comparator |
| `ALEX_HARRI_CELL` | Published 48×64 glyph cell |
| `ALEX_HARRI_ZONES` | Published 2×3 internal sampling grid |
| `ALEX_HARRI_LAYOUT` | Six internal and ten external sample positions |
| `toText` | Join an ASCII frame into newline-separated text |
| `serializeAlphabet` / `deserializeAlphabet` | Store and restore measured glyphs |
| `selectMostDistinct` | Reduce a measured alphabet while retaining separation |
| `charsets.SHAPE_ASCII` | Portable sub-50 printable palette |

Lower-level alphabet, layout, sampling, and matcher exports remain available
because they form the Harri runtime and are useful when integrating custom
fonts or streaming renderers. No experimental converter registry,
preprocessing suite, evaluator, presets, corpus, or debug server is shipped.

## Development

```bash
bun install
bun test
bun run typecheck
bun run demo
```

Tests use a deterministic stub canvas and a vendored, MIT-licensed reference
implementation for differential checks.

## Credit

The algorithm is by **Alex Harri Jónsson**, described in
[Rendering ASCII in WebGL](https://alexharri.com/blog/ascii-rendering) and
implemented in [alexharri/website](https://github.com/alexharri/website).

This package is an independent TypeScript implementation. The published sample
geometry and the reference oracle retain Alex Harri Jónsson's MIT notice. See
[LICENSE](LICENSE).
