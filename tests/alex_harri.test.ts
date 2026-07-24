import { describe, expect, test } from "bun:test";
import {
  ALEX_HARRI_CELL,
  ALEX_HARRI_LAYOUT,
  ALEX_HARRI_ZONES,
  alexHarriAlgorithm,
  buildAlexHarriAlphabet,
} from "../src/index";
import { buildLayout } from "../src/layout";
import type { Alphabet, Frame } from "../src/types";
import { stubCanvas } from "./stubCanvas";

function syntheticAlphabet(chars = [" ", "x"]): Alphabet {
  const dimensions = 6;
  const vectors = new Float32Array(chars.length * dimensions);
  for (let char = 0; char < chars.length; char++) {
    vectors.fill(char / Math.max(1, chars.length - 1), char * dimensions, (char + 1) * dimensions);
  }
  return {
    chars,
    vectors,
    dimensions,
    layout: ALEX_HARRI_LAYOUT,
    cell: ALEX_HARRI_CELL,
    font: "64px synthetic",
  };
}

function publishedPointFrame(): Frame {
  const { width, height } = ALEX_HARRI_CELL;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const point of ALEX_HARRI_LAYOUT.points) {
    const x = Math.floor(point.x * width);
    const y = Math.floor(point.y * height);
    const index = (y * width + x) * 4;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
  }
  return { data, width, height };
}

describe("Alex Harri reference geometry", () => {
  test("pins all six internal and ten external published positions", () => {
    expect(ALEX_HARRI_CELL).toEqual({ width: 48, height: 64 });
    expect(ALEX_HARRI_ZONES).toEqual({ cols: 2, rows: 3 });
    expect(ALEX_HARRI_LAYOUT.points).toEqual([
      { x: 0.3, y: 0.23 },
      { x: 0.7, y: 0.18 },
      { x: 0.3, y: 0.5 },
      { x: 0.7, y: 0.5 },
      { x: 0.3, y: 0.82 },
      { x: 0.7, y: 0.77 },
    ]);
    expect(ALEX_HARRI_LAYOUT.external).toEqual([
      { x: 0.07, y: -0.21, affects: [0, 1] },
      { x: 0.93, y: -0.21, affects: [0, 1] },
      { x: -0.25, y: 0.07, affects: [0, 2] },
      { x: 1.25, y: 0.07, affects: [1, 3] },
      { x: -0.25, y: 0.5, affects: [0, 2, 4] },
      { x: 1.25, y: 0.5, affects: [1, 3, 5] },
      { x: -0.25, y: 0.93, affects: [2, 4] },
      { x: 1.25, y: 0.93, affects: [3, 5] },
      { x: 0.07, y: 1.21, affects: [4, 5] },
      { x: 0.93, y: 1.21, affects: [4, 5] },
    ]);
    expect(ALEX_HARRI_LAYOUT.affectedBy).toEqual([
      [0, 1, 2, 4],
      [0, 1, 3, 5],
      [2, 4, 6],
      [3, 5, 7],
      [4, 6, 8, 9],
      [5, 7, 8, 9],
    ]);
    expect(ALEX_HARRI_LAYOUT.radius).toBe(13.5 / 48);
  });

  test("builds glyph vectors under the exact hand-tuned layout", () => {
    const alphabet = buildAlexHarriAlphabet({
      font: { family: "stub", size: 64 },
      chars: " ",
      canvas: stubCanvas,
      supersample: 1,
      blur: 0,
    });
    expect(alphabet.cell).toEqual(ALEX_HARRI_CELL);
    expect(alphabet.layout).toBe(ALEX_HARRI_LAYOUT);
    expect(alphabet.dimensions).toBe(6);
    expect(alphabet.vectors).toHaveLength(6);
  });

  test("refuses vectors measured under a different sampling layout", () => {
    const alphabet = syntheticAlphabet();
    alphabet.layout = buildLayout({
      zones: ALEX_HARRI_ZONES,
      cell: ALEX_HARRI_CELL,
      external: false,
    });
    expect(() =>
      alexHarriAlgorithm.convert(publishedPointFrame(), alphabet, {
        cols: 1,
        rows: 1,
        quality: 1,
      }),
    ).toThrow(/buildAlexHarriAlphabet/);
  });
});

describe("Alex Harri palette contract", () => {
  test("returns only characters from the caller's printable palette and honours exclusion", () => {
    const result = alexHarriAlgorithm.convert(publishedPointFrame(), syntheticAlphabet(), {
      cols: 1,
      rows: 1,
      quality: 1,
      exclude: "x",
    });
    expect(result.chars).toEqual([" "]);
  });

  test("rejects palettes over the 49-character comparison limit", () => {
    const chars = Array.from({ length: 50 }, (_, index) => String.fromCharCode(0x20 + index));
    expect(() =>
      alexHarriAlgorithm.convert(publishedPointFrame(), syntheticAlphabet(chars), {
        cols: 1,
        rows: 1,
        quality: 1,
      }),
    ).toThrow(/more than 49/);
  });

  test("rejects a malformed glyph-vector bank instead of silently treating holes as black", () => {
    const malformed = syntheticAlphabet();
    malformed.vectors = malformed.vectors.subarray(0, malformed.vectors.length - 1);
    expect(() =>
      alexHarriAlgorithm.convert(publishedPointFrame(), malformed, {
        cols: 1,
        rows: 1,
        quality: 1,
      }),
    ).toThrow(/glyph-vector values/);
  });
});
