import { CharacterMatcher } from "./matcher.js";
import { sampleFrame, type GridGeometry, type SampleOptions } from "./sample.js";
import type { Alphabet, AsciiFrame, Frame } from "./types.js";

export interface ConvertOptions extends SampleOptions {
  /**
   * Output width in characters. Cell size is derived from this, keeping the
   * alphabet's cell aspect ratio, and `rows` follows from the frame height.
   */
  cols?: number;
  /** Output height in characters. Overrides the value derived from `cols`. */
  rows?: number;
  /** Reuse a matcher across frames so its cache survives. */
  matcher?: CharacterMatcher;
  /** Characters to drop. Ignored when `matcher` is supplied. */
  exclude?: string;
}

/**
 * Fits a character grid to a frame, preserving the alphabet's cell aspect ratio
 * so glyphs are not stretched. Any remainder is split evenly, centring the grid.
 */
export function computeGrid(frame: Frame, alphabet: Alphabet, options: ConvertOptions = {}): GridGeometry {
  const aspect = alphabet.cell.height / alphabet.cell.width;

  const cols = Math.max(1, Math.floor(options.cols ?? frame.width / alphabet.cell.width));
  const cellWidth = frame.width / cols;
  const cellHeight = cellWidth * aspect;
  const rows = Math.max(1, Math.floor(options.rows ?? frame.height / cellHeight));

  return {
    cols,
    rows,
    cellWidth,
    cellHeight,
    originX: (frame.width - cols * cellWidth) / 2,
    originY: (frame.height - rows * cellHeight) / 2,
  };
}

/**
 * Converts one frame of RGBA pixels into characters.
 *
 * Pass the same `matcher` across frames of a video: the character grid is
 * recomputed every time, but the matcher's cache is what keeps per-frame cost
 * roughly flat.
 */
export function imageToAscii(
  frame: Frame,
  alphabet: Alphabet,
  options: ConvertOptions = {},
): AsciiFrame {
  const grid = computeGrid(frame, alphabet, options);
  const matcher =
    options.matcher ?? new CharacterMatcher(alphabet, { exclude: options.exclude });

  const { vectors, colors, dimensions } = sampleFrame(frame, alphabet.layout, grid, options);

  const chars = new Array<string>(grid.cols * grid.rows);
  for (let i = 0; i < chars.length; i++) {
    chars[i] = matcher.match(vectors.subarray(i * dimensions, (i + 1) * dimensions));
  }

  return { cols: grid.cols, rows: grid.rows, chars, colors };
}

/** Joins an `AsciiFrame` into newline-separated text. */
export function toText(frame: AsciiFrame): string {
  const lines = new Array<string>(frame.rows);
  for (let row = 0; row < frame.rows; row++) {
    lines[row] = frame.chars.slice(row * frame.cols, (row + 1) * frame.cols).join("");
  }
  return lines.join("\n");
}
