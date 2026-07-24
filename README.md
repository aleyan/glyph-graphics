# glyph-graphics

Shape-aware image-to-ASCII conversion, with an optional Three.js tilemap
renderer.

Most ASCII converters order characters only by darkness. Alex Harri Jónsson's
algorithm instead measures the ink in six regions of each glyph and compares
that shape with the same regions in an image cell. Ten neighbouring samples add
edge context. Diagonals, curves, and asymmetric glyphs can therefore survive
conversion instead of collapsing into a brightness ramp.

This package contains the focused, reusable runtime: the Harri converter,
alphabet tools, and optional Three.js renderer. Alternate algorithms,
preprocessing experiments, evaluation tools, fixture images, and debug
frontends belong in
[glyph-graphics-experiments](https://github.com/aleyan/glyph-graphics-experiments).

## Install

```bash
npm install glyph-graphics
```

The package includes ESM, CommonJS, and TypeScript declarations and supports
Node.js 20+, Bun, and modern browsers.

Three.js is an optional peer. Install it only if you use
`glyph-graphics/three`:

```bash
npm install three
npm install --save-dev @types/three
```

The root `glyph-graphics` import never loads Three.js.

## Quick start

Measure a glyph alphabet once, then use it for every image or video frame:

```ts
import {
  alexHarriAlgorithm,
  buildAlexHarriAlphabet,
  charsets,
  toText,
} from "glyph-graphics";

await document.fonts.load("64px 'Fira Code'");

const alphabet = buildAlexHarriAlphabet({
  font: { family: "Fira Code, monospace", size: 64 },
  chars: charsets.SHAPE_ASCII,
});

// `image` is a decoded HTMLImageElement, ImageBitmap, canvas, or video frame.
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

`charsets.SHAPE_ASCII` is a portable 47-character palette containing only
printable ASCII letters, numbers, punctuation, and symbols. The exact Harri
converter accepts at most 49 unique printable ASCII candidates and rejects box
drawing, block, Braille, and other non-ASCII drawing characters.

Input can be an `ImageData` object, a decoded RGBA buffer with the same shape,
or a WebGL readback. Use `flipY: true` for bottom-up pixel buffers.

## Exact Harri API

### `buildAlexHarriAlphabet(options)`

Measures the supplied characters using the published 48×64 cell, six internal
sampling regions, ten external sampling positions, and 13.5-pixel sampling
radius.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `font` | `{ family: string; size: number; style?: string }` | required | CSS font used for measurement |
| `chars` | `string \| string[]` | required | Glyph candidates to measure |
| `canvas` | `(width, height) => CanvasLike` | host canvas | Canvas implementation for browsers or servers |
| `supersample` | `number` | `2` | Measurement scale; values above 1 stabilize fine strokes |
| `pickMostDistinct` | `number` | all | Keep a smaller, well-separated subset |
| `glyphScale` | `number` | `0.97` | Glyph size relative to the font size |
| `baseline` | `number` | `0.525` | Baseline as a fraction of cell height |
| `blur` | `number` | `0` | Gaussian blur radius before measurement |

The result is an `Alphabet`. It records the characters, normalized shape
vectors, sampling layout, cell size, and font shorthand. An alphabet must be
measured with the exact Harri geometry to be passed to `alexHarriAlgorithm`.

### `alexHarriAlgorithm.convert(frame, alphabet, options?)`

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `cols` | `number` | derived | Output columns |
| `rows` | `number` | aspect-preserving | Output rows; set both dimensions for an exact grid |
| `quality` | `number` | `5` | Taps per sampling circle; 3–9 suits most images |
| `globalCrunch` | `number` | `1` | Within-cell contrast exponent; 1 disables it |
| `directionalCrunch` | `number` | `1` | Edge-context contrast exponent; 1 disables it |
| `flipY` | `boolean` | `false` | Read a bottom-up pixel buffer |
| `color` | `boolean` | `false` | Include average RGB per output cell |
| `exclude` | `string` | `""` | Candidate characters to suppress |

The `Frame` input and `AsciiFrame` output are deliberately small structural
interfaces:

```ts
interface Frame {
  data: Uint8ClampedArray | Uint8Array; // row-major RGBA
  width: number;
  height: number;
}

interface AsciiFrame {
  cols: number;
  rows: number;
  chars: string[];       // row-major, cols * rows
  colors?: Uint8Array;   // optional row-major RGB triplets
}
```

When `rows` is omitted, the converter derives it from the source dimensions and
the measured glyph aspect ratio so glyphs are not stretched. `toText(frame)`
joins the character grid with newlines.

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

Canvas packages are not runtime dependencies; choose and install the one that
fits your environment.

### Reuse and serialization

Alphabet measurement is the expensive step. Build an alphabet once and reuse
it for still images or every frame of a video. It can also be stored as JSON:

```ts
import {
  deserializeAlphabet,
  serializeAlphabet,
} from "glyph-graphics";

const json = JSON.stringify(serializeAlphabet(alphabet));
const restored = deserializeAlphabet(JSON.parse(json));
```

## Three.js renderer

`glyph-graphics/three` packs every measured glyph into an atlas and renders the
whole ASCII grid on one textured quad:

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

tilemap.setBackground(0x101014);
tilemap.setInk(0xf5f1e8);
tilemap.setUseColor(false);

// Release the geometry, material, and textures when finished.
tilemap.dispose();
```

The public `AsciiTilemap` interface is:

| Member | Meaning |
| --- | --- |
| `mesh` | The `THREE.Mesh` to add to a scene |
| `atlas` | The measured `GlyphAtlas` used by the renderer |
| `aspect` | Read-only width/height ratio after the latest update |
| `update(frame)` | Upload a new `AsciiFrame`; textures resize only if the grid changes |
| `setBackground(color)` | Set the paper color |
| `setInk(color)` | Set the fallback glyph color |
| `setUseColor(enabled)` | Enable or disable per-cell frame colors |
| `dispose()` | Release every owned GPU resource |

`AsciiTilemapOptions` accepts `background`, `ink`, `useColor`, a reusable
prebuilt `atlas`, an optional `canvas` factory, `tile` dimensions,
`glyphScale`, and `baseline`.

The adapter also exports `buildGlyphAtlas`, `packGlyphIndices`, `packColors`,
`VERTEX_SHADER`, and `FRAGMENT_SHADER` for custom rendering integrations.

## Other exports

| Area | Exports |
| --- | --- |
| Harri constants | `ALEX_HARRI_CELL`, `ALEX_HARRI_ZONES`, `ALEX_HARRI_LAYOUT` |
| General pipeline | `buildAlphabet`, `buildLayout`, `imageToAscii`, `computeGrid`, `sampleFrame` |
| Matching | `CharacterMatcher`, `KdTree`, `selectMostDistinct` |
| Storage | `serializeAlphabet`, `deserializeAlphabet` |
| Raster helpers | `rasterizeGlyph`, `circleLightness`, `lightness`, `fontShorthand` |
| Canvas integration | `defaultCanvasFactory`, `CanvasFactory`, `CanvasLike`, `Context2DLike` |
| Palettes | `charsets.ASCII`, `SYMBOLS`, `RAMP`, `SHAPE_ASCII`, plus specialty sets for the general pipeline |

The TypeScript declarations document all option and data interfaces. The
general `imageToAscii` pipeline permits custom layouts and larger or specialty
palettes; the stricter printable-ASCII and sub-50 rules apply to
`alexHarriAlgorithm`.

## Development

```bash
bun install
bun run check
bun run demo
```

`bun run check` runs the tests and type checker, builds ESM/CommonJS/declaration
outputs, packs the package, and verifies root and Three.js imports from clean
consumer projects. Tests use a deterministic stub canvas and a vendored,
MIT-licensed reference implementation for differential checks.

Release maintainers should follow [RELEASING.md](RELEASING.md).

## Credit

The algorithm is by **Alex Harri Jónsson**, described in
[Rendering ASCII in WebGL](https://alexharri.com/blog/ascii-rendering) and
implemented in [alexharri/website](https://github.com/alexharri/website).

This is an independent TypeScript implementation. The published sample
geometry and the reference oracle retain Alex Harri Jónsson's MIT notice. See
[LICENSE](LICENSE).
