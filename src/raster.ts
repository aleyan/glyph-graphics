import type { Frame } from "./types.js";

/**
 * The subset of `CanvasRenderingContext2D` this library uses. Declaring it
 * structurally lets the same code run against the DOM, `OffscreenCanvas`, and
 * server-side canvas packages without depending on any of them.
 */
export interface Context2DLike {
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, width: number, height: number): Frame;
  putImageData(data: Frame, x: number, y: number): void;
}

export interface CanvasLike {
  /** Backing-store width in pixels. */
  width: number;
  /** Backing-store height in pixels. */
  height: number;
  /** Acquire the two-dimensional context used for glyph measurement. */
  getContext(contextId: "2d"): Context2DLike | null;
}

/** Creates a canvas with the requested backing-store dimensions in pixels. */
export type CanvasFactory = (width: number, height: number) => CanvasLike;

/**
 * Resolves a canvas implementation from the host environment. Server runtimes
 * have none, so callers there must pass a factory from a canvas package.
 */
export function defaultCanvasFactory(): CanvasFactory {
  if (typeof OffscreenCanvas !== "undefined") {
    return (width, height) => new OffscreenCanvas(width, height) as unknown as CanvasLike;
  }
  if (typeof document !== "undefined") {
    return (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas as unknown as CanvasLike;
    };
  }
  throw new Error(
    "No canvas implementation found. Pass `canvas` explicitly, e.g. " +
      "`{ canvas: (w, h) => createCanvas(w, h) }` from @napi-rs/canvas or node-canvas.",
  );
}

export function getContext(canvas: CanvasLike): Context2DLike {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire a 2d context from the canvas");
  return ctx;
}

/** Rec. 709 relative luminance, normalized to `[0, 1]`. */
export function lightness(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export interface FontSpec {
  /** CSS font family, e.g. `"Fira Code, monospace"`. */
  family: string;
  /** Font size in pixels. */
  size: number;
  /** Optional CSS prefix such as `"bold"` or `"italic 600"`. */
  style?: string;
}

/** Builds a CSS font shorthand, scaling the size by `scale`. */
export function fontShorthand(font: FontSpec, scale = 1): string {
  const size = `${font.size * scale}px`;
  return font.style ? `${font.style} ${size} ${font.family}` : `${size} ${font.family}`;
}

export interface GlyphRasterOptions {
  /** Glyph size relative to the font size. Slightly under 1 keeps ink inside the cell. */
  glyphScale?: number;
  /** Baseline position as a fraction of cell height. Above 0.5 to offset descender space. */
  baseline?: number;
  /** Gaussian blur radius in pixels. Softens sharp stems so vectors compare more smoothly. */
  blur?: number;
}

/**
 * Draws one character white-on-black, filling the canvas with a single cell.
 * The canvas is reused across characters, so it is cleared on every call.
 */
export function rasterizeGlyph(
  canvas: CanvasLike,
  char: string,
  font: FontSpec,
  options: GlyphRasterOptions = {},
): void {
  const { glyphScale = 0.97, baseline = 0.525, blur = 0 } = options;
  const ctx = getContext(canvas);
  const { width, height } = canvas;

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "white";
  ctx.font = fontShorthand(font, glyphScale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(char, width * 0.5, height * baseline);

  if (blur > 0) blurCanvas(ctx, width, height, blur);
}

/** Separable Gaussian blur applied in place. */
function blurCanvas(ctx: Context2DLike, width: number, height: number, radius: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const kernel = gaussianKernel(radius);
  const half = (kernel.length - 1) / 2;
  const scratch = new Float32Array(data.length);

  const pass = (
    src: { readonly [i: number]: number },
    dst: { [i: number]: number },
    horizontal: boolean,
  ) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = -half; k <= half; k++) {
          const sx = horizontal ? clamp(x + k, 0, width - 1) : x;
          const sy = horizontal ? y : clamp(y + k, 0, height - 1);
          const i = (sy * width + sx) * 4;
          const w = kernel[k + half] ?? 0;
          r += (src[i] ?? 0) * w;
          g += (src[i + 1] ?? 0) * w;
          b += (src[i + 2] ?? 0) * w;
        }
        const i = (y * width + x) * 4;
        dst[i] = r;
        dst[i + 1] = g;
        dst[i + 2] = b;
        dst[i + 3] = 255;
      }
    }
  };

  pass(data, scratch, true);
  pass(scratch, data, false);
  ctx.putImageData(image, 0, 0);
}

function gaussianKernel(radius: number): Float32Array {
  const size = Math.ceil(radius * 2) * 2 + 1;
  const center = (size - 1) / 2;
  const sigma = Math.max(radius / 3, 1e-6);
  const denominator = 2 * sigma * sigma;

  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - center;
    const value = Math.exp(-(x * x) / denominator);
    kernel[i] = value;
    sum += value;
  }
  for (let i = 0; i < size; i++) kernel[i] = (kernel[i] ?? 0) / sum;
  return kernel;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Average lightness over every pixel whose centre falls inside the circle.
 *
 * Alphabet construction runs once, so this integrates exactly instead of
 * estimating from a handful of taps the way frame conversion does.
 */
export function circleLightness(
  frame: Frame,
  centerX: number,
  centerY: number,
  radius: number,
): number {
  const { data, width, height } = frame;
  const startX = Math.max(0, Math.floor(centerX - radius));
  const startY = Math.max(0, Math.floor(centerY - radius));
  const endX = Math.min(width, Math.ceil(centerX + radius));
  const endY = Math.min(height, Math.ceil(centerY + radius));
  const radiusSquared = radius * radius;

  let total = 0;
  let count = 0;
  for (let y = startY; y < endY; y++) {
    const dy = y - centerY;
    for (let x = startX; x < endX; x++) {
      const dx = x - centerX;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const i = (y * width + x) * 4;
      total += lightness(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}
