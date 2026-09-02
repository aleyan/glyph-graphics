/**
 * Palette-quantized ASCII video: JSONL codec, palette building, and a playback cursor.
 */

/**
 * The JSONL container format identifier. Line 1 is the header; every following
 * line is one frame as a JSON array of runs `[cellOffset, glyphs, codes]`. Frame 0
 * is a single full-grid run and the rest carry only what changed, so a decoder
 * plays the file forward by applying runs onto one reusable cell buffer.
 */
export const ASCII_VIDEO_FORMAT = "ascii-video-jsonl";
export const ASCII_VIDEO_VERSION = 1;

/**
 * Palette indexes travel as fixed-width printable-ASCII codes. The two
 * characters JSON has to escape are left out, so a code is always one byte on
 * disk and never doubles the width of a color run.
 */
const CODE_CHARS = Array.from({ length: 95 }, (_, offset) => String.fromCharCode(32 + offset))
  .filter((character) => character !== '"' && character !== "\\")
  .join("");
const CODE_BASE = CODE_CHARS.length;
const CODE_VALUES = new Map([...CODE_CHARS].map((character, index) => [character, index]));

/** Two code characters per index is the widest encoding the format defines. */
export const MAX_PALETTE_COLORS = CODE_BASE * CODE_BASE;

export type PaletteCodeWidth = 1 | 2;

/** The narrowest code width that can address `paletteSize` colors. */
export function paletteCodeWidth(paletteSize: number): PaletteCodeWidth {
  if (paletteSize <= CODE_BASE) return 1;
  if (paletteSize <= MAX_PALETTE_COLORS) return 2;
  throw new Error(`An ASCII video palette holds at most ${MAX_PALETTE_COLORS} colors`);
}

function encodePaletteIndex(index: number, width: PaletteCodeWidth): string {
  if (width === 1) return CODE_CHARS[index]!;
  return CODE_CHARS[Math.floor(index / CODE_BASE)]! + CODE_CHARS[index % CODE_BASE]!;
}

function decodePaletteCodes(codes: string, width: PaletteCodeWidth, count: number): Uint8Array {
  const indexes = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) {
    let value = 0;
    for (let digit = 0; digit < width; digit++) {
      const code = CODE_VALUES.get(codes[cell * width + digit]!);
      if (code === undefined) throw new Error(`Unknown palette code at cell ${cell}`);
      value = value * CODE_BASE + code;
    }
    indexes[cell] = value;
  }
  return indexes;
}

/** One contiguous stretch of cells a frame rewrites, starting at cell `at`. */
export interface AsciiVideoRun {
  at: number;
  glyphs: string;
  /** Palette indexes, one per glyph. */
  colors: Uint8Array;
}

export interface AsciiVideo {
  cols: number;
  rows: number;
  fps: number;
  frameCount: number;
  /** `#rrggbb` per palette index. */
  palette: string[];
  /** RGB triplets per palette index, for renderers that want bytes. */
  paletteRgb: Uint8Array;
  /** Runs per frame, in playback order. */
  frames: AsciiVideoRun[][];
}

interface AsciiVideoHeader {
  format: string;
  version: number;
  cols: number;
  rows: number;
  fps: number;
  frames: number;
  codeWidth: PaletteCodeWidth;
  /** `rrggbb` without the leading hash, which is the bulk of the header. */
  palette: string[];
}

function hexToRgb(hex: string): [number, number, number] {
  if (!/^[0-9a-f]{6}$/.test(hex)) throw new Error(`Malformed palette color "${hex}"`);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return [red, green, blue]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("");
}

export function parseAsciiVideo(text: string): AsciiVideo {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const [headerLine, ...frameLines] = lines;
  if (!headerLine) throw new Error("An ASCII video needs a header line");
  const header = JSON.parse(headerLine) as AsciiVideoHeader;
  if (header.format !== ASCII_VIDEO_FORMAT) {
    throw new Error(`Unexpected ASCII video format "${header.format}"`);
  }
  if (header.version !== ASCII_VIDEO_VERSION) {
    throw new Error(`Unsupported ASCII video version ${header.version}`);
  }
  if (frameLines.length !== header.frames) {
    throw new Error(`Header promises ${header.frames} frames but the file holds ${frameLines.length}`);
  }

  const paletteRgb = new Uint8Array(header.palette.length * 3);
  const palette = header.palette.map((hex, index) => {
    const [red, green, blue] = hexToRgb(hex);
    paletteRgb.set([red, green, blue], index * 3);
    return `#${hex}`;
  });

  const frames = frameLines.map((line, frame) => {
    const encoded = JSON.parse(line) as [number, string, string][];
    return encoded.map(([at, glyphs, codes]) => {
      if (codes.length !== glyphs.length * header.codeWidth) {
        throw new Error(`Frame ${frame} run at ${at} has ${glyphs.length} glyphs but ${codes.length} color codes`);
      }
      return {
        at,
        glyphs,
        colors: decodePaletteCodes(codes, header.codeWidth, glyphs.length),
      };
    });
  });

  return {
    cols: header.cols,
    rows: header.rows,
    fps: header.fps,
    frameCount: header.frames,
    palette,
    paletteRgb,
    frames,
  };
}

/**
 * A playhead over one reusable cell buffer. Frames are deltas against their
 * predecessor, so seeking forward applies every run in between and dropping
 * frames costs only the runs, never a repaint.
 */
export interface AsciiVideoCursor {
  /** The last applied frame, or -1 before the first one. */
  readonly frame: number;
  /** Row-major glyphs, one character per cell. */
  readonly glyphs: string[];
  /** Row-major palette indexes, one per cell. */
  readonly colors: Uint8Array;
  /** Applies every frame up to and including `frame`. Returns whether any cell changed. */
  seek: (frame: number) => boolean;
}

export function createAsciiVideoCursor(video: AsciiVideo): AsciiVideoCursor {
  const cells = video.cols * video.rows;
  const glyphs = new Array<string>(cells).fill(" ");
  const colors = new Uint8Array(cells);
  let current = -1;

  const apply = (runs: AsciiVideoRun[]) => {
    for (const run of runs) {
      for (let offset = 0; offset < run.glyphs.length; offset++) {
        glyphs[run.at + offset] = run.glyphs[offset]!;
      }
      colors.set(run.colors, run.at);
    }
  };

  return {
    get frame() {
      return current;
    },
    glyphs,
    colors,
    seek: (frame) => {
      const target = Math.max(-1, Math.min(video.frameCount - 1, Math.trunc(frame)));
      if (target === current) return false;
      // Frames only carry forward deltas, so rewinding replays from the start.
      let start = current + 1;
      if (target < current) {
        glyphs.fill(" ");
        colors.fill(0);
        start = 0;
      }
      let changed = false;
      for (let frameIndex = start; frameIndex <= target; frameIndex++) {
        const runs = video.frames[frameIndex]!;
        if (runs.length) changed = true;
        apply(runs);
      }
      current = target;
      return changed;
    },
  };
}

/** Expands palette indexes into the row-major RGB triplets tilemap renderers take. */
export function expandPaletteColors(
  indexes: Uint8Array,
  paletteRgb: Uint8Array,
  out: Uint8Array,
): Uint8Array {
  for (let cell = 0; cell < indexes.length; cell++) {
    const source = indexes[cell]! * 3;
    const target = cell * 3;
    out[target] = paletteRgb[source]!;
    out[target + 1] = paletteRgb[source + 1]!;
    out[target + 2] = paletteRgb[source + 2]!;
  }
  return out;
}

/** One converted source frame, before quantization. */
export interface AsciiVideoSourceFrame {
  /** Row-major glyphs, `cols * rows` characters. */
  chars: string;
  /** Row-major RGB triplets, `cols * rows * 3` bytes. */
  colors: Uint8Array;
}

type ColorChannel = "red" | "green" | "blue";
const CHANNELS: readonly ColorChannel[] = ["red", "green", "blue"];

interface ColorCount extends Record<ColorChannel, number> {
  count: number;
}

function colorHistogram(frames: readonly AsciiVideoSourceFrame[]): ColorCount[] {
  const counts = new Map<number, number>();
  for (const frame of frames) {
    for (let offset = 0; offset < frame.colors.length; offset += 3) {
      const key = (frame.colors[offset]! << 16) | (frame.colors[offset + 1]! << 8) | frame.colors[offset + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].map(([key, count]) => ({
    red: (key >> 16) & 0xff,
    green: (key >> 8) & 0xff,
    blue: key & 0xff,
    count,
  }));
}

/**
 * Median-cut quantization over every cell color in the video, weighted by how
 * often each color occurs. A global palette is what makes delta frames cheap:
 * a cell only enters a delta when its quantized color actually moves.
 */
export function buildAsciiVideoPalette(
  frames: readonly AsciiVideoSourceFrame[],
  maxColors: number,
): Uint8Array {
  if (maxColors > MAX_PALETTE_COLORS) {
    throw new Error(`An ASCII video palette holds at most ${MAX_PALETTE_COLORS} colors`);
  }
  const histogram = colorHistogram(frames);
  if (!histogram.length) return new Uint8Array(3);

  let boxes: ColorCount[][] = [histogram];
  while (boxes.length < maxColors) {
    let widest = -1;
    let widestRange = 0;
    let widestChannel: ColorChannel = "red";
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (const channel of CHANNELS) {
        let low = 255;
        let high = 0;
        for (const color of box) {
          low = Math.min(low, color[channel]);
          high = Math.max(high, color[channel]);
        }
        const range = high - low;
        if (range > widestRange) {
          widest = index;
          widestRange = range;
          widestChannel = channel;
        }
      }
    });
    if (widest < 0) break;

    const box = [...boxes[widest]!].sort((left, right) =>
      left[widestChannel] - right[widestChannel]);
    const total = box.reduce((sum, color) => sum + color.count, 0);
    let running = 0;
    let split = 1;
    for (let index = 0; index < box.length - 1; index++) {
      running += box[index]!.count;
      if (running * 2 >= total) {
        split = index + 1;
        break;
      }
      split = index + 2;
    }
    // One dominant color can carry the weighted median past the end of the box;
    // both halves must keep at least one color or the palette gains a dead entry.
    split = Math.max(1, Math.min(box.length - 1, split));
    boxes = boxes.flatMap((existing, index) =>
      index === widest ? [box.slice(0, split), box.slice(split)] : [existing]
    );
  }

  const palette = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, index) => {
    let weight = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (const color of box) {
      weight += color.count;
      red += color.red * color.count;
      green += color.green * color.count;
      blue += color.blue * color.count;
    }
    palette.set(
      [Math.round(red / weight), Math.round(green / weight), Math.round(blue / weight)],
      index * 3,
    );
  });
  return palette;
}

/** Nearest palette entry per color, memoized because frames repeat colors heavily. */
function createPaletteMatcher(palette: Uint8Array): (red: number, green: number, blue: number) => number {
  const cache = new Map<number, number>();
  const size = palette.length / 3;
  return (red, green, blue) => {
    const key = (red << 16) | (green << 8) | blue;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < size; index++) {
      const offset = index * 3;
      const dr = red - palette[offset]!;
      const dg = green - palette[offset + 1]!;
      const db = blue - palette[offset + 2]!;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    cache.set(key, best);
    return best;
  };
}

export interface AsciiVideoEncodeOptions {
  cols: number;
  rows: number;
  fps: number;
  frames: readonly AsciiVideoSourceFrame[];
  palette: Uint8Array;
  /**
   * Keep a cell's previous palette entry while it stays within this RGB
   * distance of the new color. Small drifts inside a gradient would otherwise
   * flip a cell back and forth between neighboring entries and pay for a delta
   * run every frame.
   */
  stickyDistance?: number;
  /**
   * Unchanged cells kept inside a run rather than starting a new one. A run
   * costs about twelve bytes of JSON and an extra cell costs two, so bridging
   * short gaps is smaller than splitting.
   */
  runGap?: number;
}

export interface AsciiVideoEncoding {
  jsonl: string;
  /** Mean RGB distance between a source color and the palette entry it got. */
  meanColorError: number;
  maxColorError: number;
}

export function encodeAsciiVideo(options: AsciiVideoEncodeOptions): AsciiVideoEncoding {
  const { cols, rows, fps, frames, palette } = options;
  const stickyDistance = options.stickyDistance ?? 0;
  const runGap = options.runGap ?? 6;
  const cells = cols * rows;
  const paletteSize = palette.length / 3;
  const codeWidth = paletteCodeWidth(paletteSize);
  const match = createPaletteMatcher(palette);

  const header: AsciiVideoHeader = {
    format: ASCII_VIDEO_FORMAT,
    version: ASCII_VIDEO_VERSION,
    cols,
    rows,
    fps,
    frames: frames.length,
    codeWidth,
    palette: Array.from({ length: paletteSize }, (_, index) =>
      rgbToHex(palette[index * 3]!, palette[index * 3 + 1]!, palette[index * 3 + 2]!)),
  };

  const previousGlyphs = new Array<string>(cells).fill("");
  const previousColors = new Uint8Array(cells);
  const lines = [JSON.stringify(header)];
  let errorTotal = 0;
  let maxColorError = 0;

  frames.forEach((frame, frameIndex) => {
    if ([...frame.chars].length !== cells) {
      throw new Error(`Frame ${frameIndex} has ${frame.chars.length} glyphs, expected ${cells}`);
    }
    const runs: string[] = [];
    let runStart = -1;
    let runGlyphs = "";
    let runCodes = "";
    let pendingGlyphs = "";
    let pendingCodes = "";
    let pendingCells = 0;

    const flush = () => {
      if (runStart < 0) return;
      runs.push(`[${runStart},${JSON.stringify(runGlyphs)},${JSON.stringify(runCodes)}]`);
      runStart = -1;
      runGlyphs = "";
      runCodes = "";
      pendingGlyphs = "";
      pendingCodes = "";
      pendingCells = 0;
    };

    for (let cell = 0; cell < cells; cell++) {
      const glyph = frame.chars[cell]!;
      const offset = cell * 3;
      const red = frame.colors[offset]!;
      const green = frame.colors[offset + 1]!;
      const blue = frame.colors[offset + 2]!;

      let index = match(red, green, blue);
      if (frameIndex > 0 && stickyDistance > 0) {
        const previous = previousColors[cell]! * 3;
        const dr = red - palette[previous]!;
        const dg = green - palette[previous + 1]!;
        const db = blue - palette[previous + 2]!;
        if (dr * dr + dg * dg + db * db <= stickyDistance * stickyDistance) {
          index = previousColors[cell]!;
        }
      }

      const chosen = index * 3;
      const dr = red - palette[chosen]!;
      const dg = green - palette[chosen + 1]!;
      const db = blue - palette[chosen + 2]!;
      const error = Math.sqrt(dr * dr + dg * dg + db * db);
      errorTotal += error;
      maxColorError = Math.max(maxColorError, error);

      const code = encodePaletteIndex(index, codeWidth);
      const changed = glyph !== previousGlyphs[cell] || index !== previousColors[cell];
      previousGlyphs[cell] = glyph;
      previousColors[cell] = index;

      if (changed) {
        if (runStart < 0) runStart = cell;
        runGlyphs += pendingGlyphs + glyph;
        runCodes += pendingCodes + code;
        pendingGlyphs = "";
        pendingCodes = "";
        pendingCells = 0;
      } else if (runStart >= 0) {
        pendingGlyphs += glyph;
        pendingCodes += code;
        pendingCells++;
        if (pendingCells > runGap) flush();
      }
    }
    flush();
    lines.push(`[${runs.join(",")}]`);
  });

  return {
    jsonl: `${lines.join("\n")}\n`,
    meanColorError: errorTotal / Math.max(1, frames.length * cells),
    maxColorError,
  };
}

