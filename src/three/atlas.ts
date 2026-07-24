import {
  defaultCanvasFactory,
  fontShorthand,
  getContext,
  type CanvasFactory,
  type FontSpec,
} from "../raster.js";
import type { Alphabet, AsciiFrame } from "../types.js";

export interface AtlasOptions {
  /**
   * Tile size in pixels. Defaults to the alphabet's cell size, rounded up.
   * Larger tiles sharpen glyph edges under magnification at a memory cost.
   */
  tile?: { width: number; height: number };
  /** Glyph size relative to tile height. Matches the alphabet's own default. */
  glyphScale?: number;
  /** Baseline position as a fraction of tile height. Matches the alphabet. */
  baseline?: number;
  /** Canvas implementation. Defaults to the host environment's. */
  canvas?: CanvasFactory;
}

/**
 * A grid of rasterized glyphs, one per alphabet character, plus the metadata a
 * shader needs to address them.
 *
 * The coverage is stored single-channel, y-down top-left, so it composes with
 * the index and colour textures without any orientation juggling.
 */
export interface GlyphAtlas {
  /** Row-major glyph coverage, one byte per pixel (0 = paper, 255 = full ink). */
  coverage: Uint8Array;
  /** Atlas dimensions in pixels. */
  width: number;
  height: number;
  /** Atlas dimensions in tiles. */
  cols: number;
  rows: number;
  /** Tile dimensions in pixels. */
  tileWidth: number;
  tileHeight: number;
  /** The character at each atlas index, in placement order. */
  chars: string[];
  /** Character → atlas index. Unknown characters fall back to index 0. */
  index: Map<string, number>;
}

/** Parses a font shorthand back into a `FontSpec` for re-rasterization. */
function parseFont(shorthand: string): FontSpec {
  const match = shorthand.match(/^(.*?)(\d+(?:\.\d+)?)px\s+(.+)$/);
  if (!match) return { family: shorthand, size: 48 };
  const style = match[1]!.trim();
  return { family: match[3]!.trim(), size: Number(match[2]), style: style || undefined };
}

/**
 * Rasterizes every character of an alphabet into one texture-ready atlas.
 *
 * The atlas is square-ish so it stays within GPU texture limits, and the glyphs
 * are drawn with the same scale and baseline the alphabet was measured at, so
 * what the matcher chose is what the screen shows.
 */
export function buildGlyphAtlas(alphabet: Alphabet, options: AtlasOptions = {}): GlyphAtlas {
  const canvasFactory = options.canvas ?? defaultCanvasFactory();
  const tileWidth = Math.max(1, Math.round(options.tile?.width ?? alphabet.cell.width));
  const tileHeight = Math.max(1, Math.round(options.tile?.height ?? alphabet.cell.height));

  const count = alphabet.chars.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const width = cols * tileWidth;
  const height = rows * tileHeight;

  const font = parseFont(alphabet.font);
  const scaledFont: FontSpec = { ...font, size: tileHeight * (options.glyphScale ?? 0.97) };
  const baseline = options.baseline ?? 0.525;

  const canvas = canvasFactory(width, height);
  const ctx = getContext(canvas);
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "white";
  ctx.font = fontShorthand(scaledFont);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const index = new Map<string, number>();
  alphabet.chars.forEach((char, i) => {
    index.set(char, i);
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.fillText(char, col * tileWidth + tileWidth * 0.5, row * tileHeight + tileHeight * baseline);
  });

  // Collapse RGBA to a single coverage channel; the glyph is greyscale, so any
  // channel carries the full signal.
  const image = ctx.getImageData(0, 0, width, height);
  const coverage = new Uint8Array(width * height);
  for (let i = 0; i < coverage.length; i++) coverage[i] = image.data[i * 4] ?? 0;

  return {
    coverage,
    width,
    height,
    cols,
    rows,
    tileWidth,
    tileHeight,
    chars: [...alphabet.chars],
    index,
  };
}

/**
 * Packs a converted frame's characters into a per-cell glyph-index texture.
 *
 * The index is split across the red and green bytes (little end first), so the
 * shader can address atlases well past 256 glyphs. Alpha is left at 255.
 */
export function packGlyphIndices(frame: AsciiFrame, atlas: GlyphAtlas): Uint8Array {
  const data = new Uint8Array(frame.cols * frame.rows * 4);
  for (let i = 0; i < frame.chars.length; i++) {
    const glyph = atlas.index.get(frame.chars[i] ?? " ") ?? 0;
    data[i * 4] = glyph & 0xff;
    data[i * 4 + 1] = (glyph >> 8) & 0xff;
    data[i * 4 + 3] = 255;
  }
  return data;
}

/**
 * Packs a converted frame's per-cell colours into an RGBA texture. Cells fall
 * back to white when the frame carries no colour, leaving glyphs untinted.
 */
export function packColors(frame: AsciiFrame): Uint8Array {
  const data = new Uint8Array(frame.cols * frame.rows * 4);
  const colors = frame.colors;
  for (let i = 0; i < frame.cols * frame.rows; i++) {
    if (colors) {
      data[i * 4] = colors[i * 3] ?? 255;
      data[i * 4 + 1] = colors[i * 3 + 1] ?? 255;
      data[i * 4 + 2] = colors[i * 3 + 2] ?? 255;
    } else {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
    }
    data[i * 4 + 3] = 255;
  }
  return data;
}
