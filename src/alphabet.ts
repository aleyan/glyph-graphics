import { buildLayout, type LayoutOptions } from "./layout";
import {
  circleLightness,
  defaultCanvasFactory,
  getContext,
  rasterizeGlyph,
  type CanvasFactory,
  type FontSpec,
  type GlyphRasterOptions,
} from "./raster";
import { selectMostDistinct } from "./select";
import type {
  Alphabet,
  CellSize,
  SamplingLayout,
  SerializedAlphabet,
  ZoneGrid,
} from "./types";

export interface BuildAlphabetOptions extends GlyphRasterOptions {
  /** Font to measure. In a browser, ensure it is loaded before calling. */
  font: FontSpec;
  /** Character cell dimensions in pixels. The aspect ratio is what matters. */
  cell: CellSize;
  /** Sampling zones per cell, e.g. `{ cols: 2, rows: 3 }`. */
  zones: ZoneGrid;
  /** Characters to measure, as a string or array. */
  chars: string | string[];
  /**
   * Supersampling factor for glyph rasterization. Above 1 the glyph is drawn
   * larger and averaged down, which steadies vectors for hairline characters.
   */
  supersample?: number;
  /**
   * Reduce to this many characters, chosen to spread out across the vector
   * space. Useful when a smaller set renders more legibly than a crowded one.
   */
  pickMostDistinct?: number;
  /** Canvas implementation. Defaults to the host environment's. */
  canvas?: CanvasFactory;
  /** Layout tuning. `zones` and `cell` are taken from the options above. */
  layout?: Omit<LayoutOptions, "zones" | "cell">;
  /**
   * An exact sampling layout, for reproducing a hand-tuned published geometry.
   * When supplied this takes precedence over `layout`; its zone grid must
   * match `zones`.
   */
  samplingLayout?: SamplingLayout;
}

/**
 * Measures how much ink each character places in each sampling zone, producing
 * the shape vectors that frame conversion matches against.
 *
 * This is the expensive, one-time half of the pipeline: run it at build time
 * for a fixed font and serialize the result.
 */
export function buildAlphabet(options: BuildAlphabetOptions): Alphabet {
  const {
    font,
    cell,
    zones,
    chars,
    supersample = 2,
    pickMostDistinct,
    canvas: canvasFactory = defaultCanvasFactory(),
    layout: layoutOptions,
    samplingLayout,
    ...rasterOptions
  } = options;

  const characters = typeof chars === "string" ? [...chars] : chars;
  if (characters.length === 0) throw new Error("`chars` must contain at least one character");
  if (supersample < 1) throw new Error(`supersample must be at least 1, got ${supersample}`);

  if (
    samplingLayout &&
    (samplingLayout.zones.cols !== zones.cols || samplingLayout.zones.rows !== zones.rows)
  ) {
    throw new Error(
      `samplingLayout zones ${samplingLayout.zones.cols}x${samplingLayout.zones.rows} ` +
        `must match requested zones ${zones.cols}x${zones.rows}`,
    );
  }

  const layout = samplingLayout ?? buildLayout({ ...layoutOptions, zones, cell });
  const dimensions = layout.points.length;

  const width = Math.round(cell.width * supersample);
  const height = Math.round(cell.height * supersample);
  const canvas = canvasFactory(width, height);
  const ctx = getContext(canvas);
  const scaledFont: FontSpec = { ...font, size: font.size * supersample };
  const radius = layout.radius * width;

  const vectors = new Float32Array(characters.length * dimensions);
  for (let c = 0; c < characters.length; c++) {
    rasterizeGlyph(canvas, characters[c] ?? " ", scaledFont, rasterOptions);
    const frame = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < dimensions; i++) {
      const point = layout.points[i];
      if (!point) continue;
      vectors[c * dimensions + i] = circleLightness(
        frame,
        point.x * width,
        point.y * height,
        radius,
      );
    }
  }

  // One shared divisor rather than one per dimension: scaling dimensions
  // independently would distort the shape space and make distances meaningless.
  normalize(vectors);

  const alphabet: Alphabet = {
    chars: characters,
    vectors,
    dimensions,
    layout,
    cell,
    font: `${font.style ? `${font.style} ` : ""}${font.size}px ${font.family}`,
  };

  return pickMostDistinct ? selectMostDistinct(alphabet, pickMostDistinct) : alphabet;
}

function normalize(vectors: Float32Array): void {
  let max = 0;
  for (let i = 0; i < vectors.length; i++) max = Math.max(max, vectors[i] ?? 0);
  if (max === 0) return;
  for (let i = 0; i < vectors.length; i++) vectors[i] = (vectors[i] ?? 0) / max;
}

export function serializeAlphabet(alphabet: Alphabet): SerializedAlphabet {
  const { chars, vectors, dimensions, layout, cell, font } = alphabet;
  return {
    chars,
    vectors: chars.map((_, i) => Array.from(vectors.subarray(i * dimensions, (i + 1) * dimensions))),
    layout,
    cell,
    font,
  };
}

export function deserializeAlphabet(data: SerializedAlphabet): Alphabet {
  const dimensions = data.layout.points.length;
  const vectors = new Float32Array(data.chars.length * dimensions);
  data.vectors.forEach((vector, i) => vectors.set(vector, i * dimensions));
  return {
    chars: data.chars,
    vectors,
    dimensions,
    layout: data.layout,
    cell: data.cell,
    font: data.font,
  };
}
