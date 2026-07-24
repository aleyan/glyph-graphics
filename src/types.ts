/**
 * A point in normalized cell space. `(0, 0)` is the cell's top-left corner and
 * `(1, 1)` its bottom-right, so external points fall outside the unit square.
 */
export interface SamplePoint {
  x: number;
  y: number;
}

/**
 * A sampling circle placed outside the cell. It carries no dimension of its own
 * in the shape vector; it only supplies the reference brightness used to sharpen
 * the internal components listed in `affects`.
 */
export interface ExternalSamplePoint extends SamplePoint {
  /** Indices into `SamplingLayout.points`. */
  affects: number[];
}

/** Width and height in pixels of one character cell. */
export interface CellSize {
  width: number;
  height: number;
}

/** How many sampling zones a cell is divided into. */
export interface ZoneGrid {
  cols: number;
  rows: number;
}

/**
 * The sampling geometry shared by alphabet construction and image conversion.
 * A vector produced under one layout is only comparable to vectors produced
 * under the same layout.
 */
export interface SamplingLayout {
  zones: ZoneGrid;
  /** Internal circles, row-major. One vector dimension each. */
  points: SamplePoint[];
  /** Circles outside the cell, used for directional contrast. May be empty. */
  external: ExternalSamplePoint[];
  /**
   * For each internal point, the external points that affect it. This is the
   * inverse of `external[i].affects`, precomputed because the conversion inner
   * loop needs it per component.
   */
  affectedBy: number[][];
  /** Circle radius, normalized to cell width. */
  radius: number;
}

/**
 * A character set with a shape vector per character, measured under `layout`
 * for a specific font at a specific cell size.
 */
export interface Alphabet {
  chars: string[];
  /** Row-major: `dimensions` consecutive values per character. */
  vectors: Float32Array;
  dimensions: number;
  layout: SamplingLayout;
  cell: CellSize;
  /** The CSS font shorthand the glyphs were rasterized with. */
  font: string;
}

/** JSON-safe form of an `Alphabet`, for building at build time and loading at runtime. */
export interface SerializedAlphabet {
  chars: string[];
  vectors: number[][];
  layout: SamplingLayout;
  cell: CellSize;
  font: string;
}

/** RGBA pixels, as produced by `ImageData`, `readPixels`, or an image decoder. */
export interface Frame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** The result of converting one frame. */
export interface AsciiFrame {
  cols: number;
  rows: number;
  /** Row-major, `cols * rows` entries. */
  chars: string[];
  /** Row-major RGB triplets, present only when color sampling was requested. */
  colors?: Uint8Array;
}
