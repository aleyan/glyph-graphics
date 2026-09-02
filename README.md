# glyph-graphics

Shape-aware image-to-ASCII conversion based on Alex Harri Jónsson's
[Rendering ASCII in WebGL](https://alexharri.com/blog/ascii-rendering).

Instead of ranking glyphs by brightness alone, `glyph-graphics` compares the
shape of each image cell with measured glyph shapes. Core conversion, JSONL
video, and Three.js rendering are separate entrypoints, so applications only
load the pieces they use.

## Install

```bash
bun add glyph-graphics
```

## Usage

Load the font, measure an alphabet once, then reuse it for every frame:

```ts
import { buildAlphabet, charsets, convert, toText } from "glyph-graphics";

await document.fonts.load("64px 'Fira Code'");

const alphabet = buildAlphabet({
  font: { family: "Fira Code, monospace", size: 64 },
  chars: charsets.SHAPE_ASCII,
});

const canvas = document.createElement("canvas");
canvas.width = image.width;
canvas.height = image.height;

const context = canvas.getContext("2d")!;
context.drawImage(image, 0, 0);

const ascii = convert(
  context.getImageData(0, 0, canvas.width, canvas.height),
  alphabet,
  { cols: 100 },
);

console.log(toText(ascii));
```

`convert` accepts `ImageData` or any object with row-major RGBA `data`,
`width`, and `height`. It returns a row-major character grid:

```ts
interface AsciiFrame {
  cols: number;
  rows: number;
  chars: string[];
  colors?: Uint8Array;
}
```

Set `color: true` to include one RGB triplet per output cell. Set `flipY: true`
for bottom-up buffers such as WebGL readbacks.

### Options

`buildAlphabet` requires `font` and `chars`. Its useful optional settings are:

| Option | Default | Purpose |
| --- | --- | --- |
| `supersample` | `2` | Stabilize thin glyph strokes during measurement |
| `pickMostDistinct` | all | Reduce the palette to the most distinct glyphs |
| `glyphScale` | `0.97` | Scale glyphs relative to the measured cell |
| `baseline` | `0.525` | Position glyphs vertically within the cell |
| `canvas` | browser canvas | Supply a canvas implementation in a headless runtime |

`convert(frame, alphabet, options)` accepts:

| Option | Default | Purpose |
| --- | --- | --- |
| `cols` | source-derived | Output width in characters |
| `rows` | aspect-preserving | Override the derived output height |
| `quality` | `5` | Samples per measurement circle; 3–9 is usually useful |
| `globalCrunch` | `1` | Increase within-cell contrast; `1` disables it |
| `directionalCrunch` | `1` | Sharpen edges between cells; `1` disables it |
| `color` | `false` | Include per-cell RGB colors |
| `flipY` | `false` | Read a bottom-up source buffer |
| `exclude` | `""` | Suppress selected characters |

`charsets.SHAPE_ASCII` is the recommended 47-character palette. Custom
palettes may contain up to 49 unique printable ASCII characters.

### Save an alphabet

Font measurement is the expensive step. A measured alphabet can be stored as
JSON and restored later:

```ts
import { deserializeAlphabet, serializeAlphabet } from "glyph-graphics";

const json = JSON.stringify(serializeAlphabet(alphabet));
const restored = deserializeAlphabet(JSON.parse(json));
```

### Headless usage

Canvas support is injected rather than installed by this package:

```ts
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { buildAlphabet, charsets, type CanvasLike } from "glyph-graphics";

GlobalFonts.registerFromPath("./FiraCode-Regular.ttf", "Fira Code");

const alphabet = buildAlphabet({
  font: { family: "Fira Code", size: 64 },
  chars: charsets.SHAPE_ASCII,
  canvas: (width, height) => createCanvas(width, height) as unknown as CanvasLike,
});
```

## Optional Three.js rendering

The core package does not load Three.js or WebGL. Install Three.js only when
you want the GPU tilemap renderer, then import its separate entrypoint:

```bash
bun add three
bun add -d @types/three
```

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

tilemap.dispose();
```

`three` is an optional peer dependency. Importing `glyph-graphics` never pulls
it into the application; only `glyph-graphics/three` does. For custom shaders or materials, the adapter also exports `buildGlyphAtlas`, `packGlyphIndices`, `packColors`, `VERTEX_SHADER`, and `FRAGMENT_SHADER`.

## Optional JSONL video

`glyph-graphics/video` stores prerendered ASCII frames as palette-quantized,
delta-encoded JSONL. This is useful when you want to convert a source video once
at build time and send the smaller ASCII representation over the wire. The
codec does not import Three.js or a video decoder.

Convert decoded source frames with `color: true`, then encode them:

```ts
import {
  buildAsciiVideoPalette,
  encodeAsciiVideo,
  type AsciiVideoSourceFrame,
} from "glyph-graphics/video";

const frames: AsciiVideoSourceFrame[] = convertedFrames.map((frame) => ({
  chars: frame.chars.join(""),
  colors: frame.colors!,
}));

const palette = buildAsciiVideoPalette(frames, 93);
const { jsonl } = encodeAsciiVideo({
  cols: convertedFrames[0]!.cols,
  rows: convertedFrames[0]!.rows,
  fps: 60,
  frames,
  palette,
  stickyDistance: 6,
});

await Bun.write("video.ascii.jsonl", jsonl);
```

On the client, parse the JSONL and seek through its delta frames:

```ts
import { createAsciiVideoCursor, parseAsciiVideo } from "glyph-graphics/video";

const video = parseAsciiVideo(await response.text());
const cursor = createAsciiVideoCursor(video);

cursor.seek(frameIndex);
// cursor.glyphs and cursor.colors are reusable row-major buffers.
```

`expandPaletteColors` converts the cursor's palette indexes to the RGB buffer
accepted by `AsciiTilemap`. Terminal applications can use `playAsciiVideo` for
clock-based ANSI playback with frame dropping.

## API

The recommended root API is `buildAlphabet`, `convert`, `toText`, `charsets`,
`serializeAlphabet`, and `deserializeAlphabet`. Configurable layout, sampling,
and matching exports remain available for advanced pipelines. Optional features
live at `glyph-graphics/three` and `glyph-graphics/video`.

## Development

```bash
bun install
bun run check
bun run demo
```

## Credit

The conversion method and sampling geometry are based on Alex Harri Jónsson's
[Rendering ASCII in WebGL](https://alexharri.com/blog/ascii-rendering). This is
an independent TypeScript implementation; see [LICENSE](LICENSE).
