import type { CanvasFactory, CanvasLike, Context2DLike } from "../src/raster";
import type { Frame } from "../src/types";

/**
 * A canvas that "rasterizes" block characters analytically.
 *
 * Bun has no canvas and no font stack, but the pipeline's contract is only that
 * glyphs become ink coverage. Block characters have exactly known coverage, so
 * this stub exercises the real code paths while keeping assertions exact.
 */
const BLOCKS: Record<string, [x0: number, y0: number, x1: number, y1: number][]> = {
  " ": [],
  "█": [[0, 0, 1, 1]],
  "▀": [[0, 0, 1, 0.5]],
  "▄": [[0, 0.5, 1, 1]],
  "▌": [[0, 0, 0.5, 1]],
  "▐": [[0.5, 0, 1, 1]],
  "▘": [[0, 0, 0.5, 0.5]],
  "▗": [[0.5, 0.5, 1, 1]],
};

class StubContext implements Context2DLike {
  fillStyle = "black";
  font = "";
  textAlign = "start";
  textBaseline = "alphabetic";

  constructor(
    private readonly data: Uint8ClampedArray,
    private readonly width: number,
    private readonly height: number,
  ) {}

  protected paint(x0: number, y0: number, x1: number, y1: number, value: number): void {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.height, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.width, Math.ceil(x1)); x++) {
        const i = (y * this.width + x) * 4;
        this.data[i] = value;
        this.data[i + 1] = value;
        this.data[i + 2] = value;
        this.data[i + 3] = 255;
      }
    }
  }

  /** Paints ink (255) over a rectangle. Exposed for position-aware subclasses. */
  protected paintRegion(x0: number, y0: number, x1: number, y1: number): void {
    this.paint(x0, y0, x1, y1, 255);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.paint(x, y, x + width, y + height, this.fillStyle === "white" ? 255 : 0);
  }

  fillText(text: string, _x?: number, _y?: number): void {
    const regions = BLOCKS[text];
    if (!regions) throw new Error(`StubCanvas has no coverage defined for ${JSON.stringify(text)}`);
    for (const [x0, y0, x1, y1] of regions) {
      this.paint(x0 * this.width, y0 * this.height, x1 * this.width, y1 * this.height, 255);
    }
  }

  getImageData(x: number, y: number, width: number, height: number): Frame {
    const out = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      const start = ((y + row) * this.width + x) * 4;
      out.set(this.data.subarray(start, start + width * 4), row * width * 4);
    }
    return { data: out, width, height };
  }

  putImageData(frame: Frame, x: number, y: number): void {
    for (let row = 0; row < frame.height; row++) {
      const source = frame.data.subarray(row * frame.width * 4, (row + 1) * frame.width * 4);
      this.data.set(source, ((y + row) * this.width + x) * 4);
    }
  }
}

export const stubCanvas: CanvasFactory = (width, height): CanvasLike => {
  const data = new Uint8ClampedArray(width * height * 4);
  const ctx = new StubContext(data, width, height);
  return { width, height, getContext: () => ctx };
};

/**
 * A position-aware variant for the atlas, which draws many glyphs at different
 * offsets into one canvas. The base stub maps block coverage to the whole canvas
 * (correct only when the canvas is a single cell); this one honours the draw
 * anchor, placing each glyph in a `tileWidth × tileHeight` cell under the same
 * `textAlign: "center"` / `textBaseline: "middle"` convention the code uses.
 */
class TiledStubContext extends StubContext {
  constructor(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    private readonly tileWidth: number,
    private readonly tileHeight: number,
    private readonly baseline: number,
  ) {
    super(data, width, height);
  }

  override fillText(text: string, x: number, y: number): void {
    const regions = BLOCKS[text];
    if (!regions) throw new Error(`StubCanvas has no coverage defined for ${JSON.stringify(text)}`);
    const left = x - this.tileWidth / 2;
    const top = y - this.baseline * this.tileHeight;
    for (const [x0, y0, x1, y1] of regions) {
      this.paintRegion(
        left + x0 * this.tileWidth,
        top + y0 * this.tileHeight,
        left + x1 * this.tileWidth,
        top + y1 * this.tileHeight,
      );
    }
  }
}

export function tiledStubCanvas(
  tileWidth: number,
  tileHeight: number,
  baseline: number,
): CanvasFactory {
  return (width, height): CanvasLike => {
    const data = new Uint8ClampedArray(width * height * 4);
    const ctx = new TiledStubContext(data, width, height, tileWidth, tileHeight, baseline);
    return { width, height, getContext: () => ctx };
  };
}

/** Characters the stub can render, ordered dark to light. */
export const STUB_CHARS = Object.keys(BLOCKS);
