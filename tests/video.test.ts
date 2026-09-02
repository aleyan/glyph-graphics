import { describe, expect, it, test } from "bun:test";
import {
  buildAsciiVideoPalette,
  createAsciiVideoCursor,
  encodeAsciiVideo,
  expandPaletteColors,
  MAX_PALETTE_COLORS,
  paletteCodeWidth,
  parseAsciiVideo,
  type AsciiVideoSourceFrame,
} from "../src/video/codec.js";
import {
  asciiVideoOpening,
  createAsciiVideoPainter,
  playAsciiVideo,
} from "../src/video/terminal.js";

const COLS = 4;
const ROWS = 2;
const CELLS = COLS * ROWS;
const PALETTE = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0]);

/** A frame whose colors are palette entries already, so encoding is lossless. */
function frameOf(chars: string, indexes: number[]): AsciiVideoSourceFrame {
  const colors = new Uint8Array(CELLS * 3);
  indexes.forEach((index, cell) => {
    colors.set(PALETTE.subarray(index * 3, index * 3 + 3), cell * 3);
  });
  return { chars, colors };
}

function encoded(frames: AsciiVideoSourceFrame[], palette = PALETTE) {
  return parseAsciiVideo(encodeAsciiVideo({
    cols: COLS,
    rows: ROWS,
    fps: 60,
    frames,
    palette,
  }).jsonl);
}

describe("ascii video codec", () => {
  it("replays every frame exactly through the delta cursor", () => {
    const frames = [
      frameOf("abcdefgh", [0, 1, 2, 0, 1, 2, 0, 1]),
      frameOf("abcdefgh", [0, 1, 2, 0, 1, 2, 0, 1]),
      frameOf("aXcdefgh", [2, 1, 2, 0, 1, 2, 0, 1]),
    ];
    const video = encoded(frames);
    const cursor = createAsciiVideoCursor(video);

    expect(video.frameCount).toBe(3);
    expect(video.palette).toEqual(["#000000", "#ff0000", "#00ff00"]);
    for (const [index, frame] of frames.entries()) {
      cursor.seek(index);
      expect(cursor.glyphs.join("")).toBe(frame.chars);
      expect(
        Array.from(expandPaletteColors(cursor.colors, video.paletteRgb, new Uint8Array(CELLS * 3))),
      ).toEqual(Array.from(frame.colors));
    }
  });

  it("spends nothing on a frame that repeats its predecessor", () => {
    const video = encoded([
      frameOf("abcdefgh", [0, 1, 2, 0, 1, 2, 0, 1]),
      frameOf("abcdefgh", [0, 1, 2, 0, 1, 2, 0, 1]),
      frameOf("abcdefgZ", [0, 1, 2, 0, 1, 2, 0, 1]),
    ]);

    expect(video.frames[0]).toHaveLength(1);
    expect(video.frames[0]![0]!.glyphs).toHaveLength(CELLS);
    expect(video.frames[1]).toEqual([]);
    expect(video.frames[2]).toEqual([
      { at: 7, glyphs: "Z", colors: new Uint8Array([1]) },
    ]);
  });

  it("rewinds by replaying from the first frame", () => {
    const video = encoded([
      frameOf("abcdefgh", [0, 0, 0, 0, 0, 0, 0, 0]),
      frameOf("ZZZZZZZZ", [2, 2, 2, 2, 2, 2, 2, 2]),
    ]);
    const cursor = createAsciiVideoCursor(video);

    cursor.seek(1);
    expect(cursor.glyphs.join("")).toBe("ZZZZZZZZ");
    cursor.seek(0);
    expect(cursor.frame).toBe(0);
    expect(cursor.glyphs.join("")).toBe("abcdefgh");
    expect(Array.from(cursor.colors)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("widens palette codes past the single-character alphabet", () => {
    const size = 100;
    const palette = new Uint8Array(size * 3);
    for (let index = 0; index < size; index++) palette[index * 3] = index;
    const colors = new Uint8Array(CELLS * 3);
    const indexes = [0, 1, 42, 93, 94, 99, 50, 7];
    indexes.forEach((index, cell) => {
      colors[cell * 3] = index;
    });

    const video = parseAsciiVideo(encodeAsciiVideo({
      cols: COLS,
      rows: ROWS,
      fps: 60,
      frames: [{ chars: "abcdefgh", colors }],
      palette,
    }).jsonl);
    const cursor = createAsciiVideoCursor(video);
    cursor.seek(0);

    expect(paletteCodeWidth(size)).toBe(2);
    expect(Array.from(cursor.colors)).toEqual(indexes);
  });

  it("refuses a palette wider than the format can address", () => {
    expect(() => paletteCodeWidth(MAX_PALETTE_COLORS + 1)).toThrow(/at most/);
  });

  it("quantizes to a palette that keeps the frequent colors apart", () => {
    const frames: AsciiVideoSourceFrame[] = [{
      chars: "abcdefgh",
      colors: new Uint8Array([
        0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2,
        250, 250, 250, 252, 252, 252, 120, 0, 0, 122, 0, 0,
      ]),
    }];
    const palette = buildAsciiVideoPalette(frames, 4);

    expect(palette).toHaveLength(4 * 3);
    // Three well-separated clusters, so no entry may collapse onto another.
    const entries = new Set(Array.from({ length: 4 }, (_, index) =>
      palette.slice(index * 3, index * 3 + 3).join(",")));
    expect(entries.size).toBe(4);
  });
});

/**
 * Replays ANSI output to a virtual terminal screen map.
 */
function replayAnsi(output: string, screen: Map<string, string>): void {
  let row = 0;
  let col = 0;
  let color = "";
  for (const token of output.matchAll(/\x1b\[(\d+);(\d+)H|\x1b\[38;2;(\d+);(\d+);(\d+)m|([^\x1b])/g)) {
    const [, cupRow, cupCol, red, green, blue, glyph] = token;
    if (cupRow && cupCol) {
      row = Number(cupRow) - 1;
      col = Number(cupCol) - 1;
    } else if (red) {
      color = `#${[red, green, blue].map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`;
    } else if (glyph) {
      screen.set(`${row},${col}`, `${glyph}@${color}`);
      col++;
    }
  }
}

describe("terminal ascii video playback", () => {
  const video = encoded([
    frameOf("abcdefgh", [0, 0, 1, 1, 2, 2, 0, 0]),
    frameOf("abcdefgh", [0, 0, 1, 1, 2, 2, 0, 0]),
    frameOf("abcZefgh", [0, 0, 1, 1, 2, 2, 0, 0]),
  ]);

  it("paints the whole grid once and then only what moved", () => {
    const painter = createAsciiVideoPainter(video, { x: 2, y: 3 });
    const cursor = createAsciiVideoCursor(video);

    cursor.seek(0);
    const first = painter.paint(cursor.glyphs, cursor.colors);
    expect(first).toContain("\x1b[4;3H");
    expect(first).toContain("\x1b[5;3H");
    expect(first.replaceAll(/\x1b\[[\d;]*[Hm]/g, "")).toBe("abcdefgh");

    expect(painter.paint(cursor.glyphs, cursor.colors)).toBe("");

    cursor.seek(2);
    const delta = painter.paint(cursor.glyphs, cursor.colors);
    expect(delta.match(/\x1b\[\d+;\d+H/g)).toEqual(["\x1b[4;6H"]);
    expect(delta.replaceAll(/\x1b\[[\d;]*[Hm]/g, "")).toBe("Z");
  });

  it("sends a truecolor foreground only when the cell color changes", () => {
    const painter = createAsciiVideoPainter(video, { x: 0, y: 0 });
    const cursor = createAsciiVideoCursor(video);
    cursor.seek(0);

    const colorRuns = painter.paint(cursor.glyphs, cursor.colors).match(/\x1b\[38;2;[\d;]+m/g);

    expect(colorRuns).toEqual([
      "\x1b[38;2;0;0;0m",
      "\x1b[38;2;255;0;0m",
      "\x1b[38;2;0;255;0m",
      "\x1b[38;2;0;0;0m",
    ]);
  });

  it("reconstructs each frame on a terminal that replays its output", () => {
    const origin = { x: 3, y: 1 };
    const painter = createAsciiVideoPainter(video, origin);
    const cursor = createAsciiVideoCursor(video);
    const screen = new Map<string, string>();

    for (let frame = 0; frame < video.frameCount; frame++) {
      cursor.seek(frame);
      replayAnsi(painter.paint(cursor.glyphs, cursor.colors), screen);

      const painted = Array.from({ length: CELLS }, (_, cell) => {
        const row = origin.y + Math.floor(cell / COLS);
        const col = origin.x + (cell % COLS);
        return screen.get(`${row},${col}`);
      });
      expect(painted).toEqual(Array.from(
        { length: CELLS },
        (_, cell) => `${cursor.glyphs[cell]}@${video.palette[cursor.colors[cell]!]}`,
      ));
    }
  });

  it("takes its playhead from the clock, so a late frame drops instead of lagging", async () => {
    const output: string[] = [];
    let clock = 0;
    const pending: (() => void)[] = [];
    const playback = playAsciiVideo({
      video,
      origin: { x: 0, y: 0 },
      write: (text) => output.push(text),
      background: [4, 6, 10],
      now: () => clock,
      timer: {
        setTimeout: (handler) => {
          pending.push(handler);
          return pending.length;
        },
        clearTimeout: () => {},
      },
    });

    expect(output[0]).toBe(asciiVideoOpening([4, 6, 10]));
    expect(output[1]!.replaceAll(/\x1b\[[\d;]*[Hm]/g, "")).toBe("abcdefgh");

    // 40 ms is frame 2 at 60fps; frame 1 must never be painted on its own.
    clock = 40;
    pending.pop()!();
    expect(output.at(-1)!.replaceAll(/\x1b\[[\d;]*[Hm]/g, "")).toBe("Z");
    await expect(playback.finished).resolves.toBeUndefined();
  });

  it("stops early and resolves when the viewer skips", async () => {
    const output: string[] = [];
    const playback = playAsciiVideo({
      video,
      origin: { x: 0, y: 0 },
      write: (text) => output.push(text),
      background: [4, 6, 10],
      now: () => 0,
      timer: { setTimeout: () => 1, clearTimeout: () => {} },
    });

    playback.stop();
    await playback.finished;
    expect(output.at(-1)!.replaceAll(/\x1b\[[\d;]*[Hm]/g, "")).toBe("abcdefgh");
  });
});

