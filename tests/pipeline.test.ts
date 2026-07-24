import { describe, expect, test } from "bun:test";
import { buildAlphabet, deserializeAlphabet, serializeAlphabet } from "../src/alphabet";
import { computeGrid, imageToAscii, toText } from "../src/convert";
import { CharacterMatcher } from "../src/matcher";
import { sampleFrame } from "../src/sample";
import { selectMostDistinct } from "../src/select";
import type { Alphabet, Frame } from "../src/types";
import { stubCanvas, STUB_CHARS } from "./stubCanvas";

const CELL = { width: 8, height: 16 };
const FONT = { family: "stub", size: 16 };

function blockAlphabet(zones = { cols: 2, rows: 2 }): Alphabet {
  return buildAlphabet({
    font: FONT,
    cell: CELL,
    zones,
    chars: STUB_CHARS,
    canvas: stubCanvas,
    supersample: 2,
    // The stub paints exact rectangles; blur and glyph scaling would only
    // soften edges that are already where we want them.
    blur: 0,
    glyphScale: 1,
    baseline: 0.5,
  });
}

/** Builds a frame from a per-pixel grey function. */
function makeFrame(width: number, height: number, grey: (x: number, y: number) => number): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = grey(x, y);
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function vectorOf(alphabet: Alphabet, char: string): number[] {
  const index = alphabet.chars.indexOf(char);
  expect(index).toBeGreaterThanOrEqual(0);
  return Array.from(
    alphabet.vectors.subarray(index * alphabet.dimensions, (index + 1) * alphabet.dimensions),
  );
}

describe("buildAlphabet", () => {
  test("measures ink coverage per zone", () => {
    const alphabet = blockAlphabet();

    expect(alphabet.dimensions).toBe(4);
    expect(vectorOf(alphabet, " ")).toEqual([0, 0, 0, 0]);
    expect(vectorOf(alphabet, "█")).toEqual([1, 1, 1, 1]);

    // Zone order is row-major, so the upper half block lights the first two.
    const upper = vectorOf(alphabet, "▀");
    expect(upper[0]).toBeCloseTo(1, 5);
    expect(upper[1]).toBeCloseTo(1, 5);
    expect(upper[2]).toBeCloseTo(0, 5);
    expect(upper[3]).toBeCloseTo(0, 5);

    // Zones are 4px wide against a 1.86px radius, and the inset pushes centres
    // outward, so a horizontal circle laps ~2% over the vertical midline. The
    // vertical zones are twice as tall, so no such overlap occurs there.
    const left = vectorOf(alphabet, "▌");
    expect(left[0]).toBeGreaterThan(0.95);
    expect(left[2]).toBeGreaterThan(0.95);
    expect(left[1]).toBeLessThan(0.05);
    expect(left[3]).toBeLessThan(0.05);
  });

  test("distinguishes left from right, which a density ramp cannot", () => {
    const alphabet = blockAlphabet();
    expect(vectorOf(alphabet, "▌")).not.toEqual(vectorOf(alphabet, "▐"));
    expect(vectorOf(alphabet, "▘")).not.toEqual(vectorOf(alphabet, "▗"));
  });

  test("normalizes by one shared divisor so relative shape survives", () => {
    const alphabet = blockAlphabet();
    let max = 0;
    for (const value of alphabet.vectors) max = Math.max(max, value);
    expect(max).toBeCloseTo(1, 6);

    // A quarter block must keep one fully-inked zone and three empty ones,
    // rather than being rescaled so its own dim zones stretch to fill [0, 1].
    const quarter = vectorOf(alphabet, "▘");
    expect(Math.max(...quarter)).toBeGreaterThan(0.95);
    expect(quarter.filter((v) => v < 0.001)).toHaveLength(3);
  });

  test("survives a serialize/deserialize round trip", () => {
    const alphabet = blockAlphabet();
    const restored = deserializeAlphabet(JSON.parse(JSON.stringify(serializeAlphabet(alphabet))));

    expect(restored.chars).toEqual(alphabet.chars);
    expect(restored.dimensions).toBe(alphabet.dimensions);
    expect(restored.cell).toEqual(alphabet.cell);
    expect(restored.layout.affectedBy).toEqual(alphabet.layout.affectedBy);
    expect(Array.from(restored.vectors)).toEqual(Array.from(alphabet.vectors));
  });

  test("honours the zone grid it is given", () => {
    expect(blockAlphabet({ cols: 1, rows: 2 }).dimensions).toBe(2);
    expect(blockAlphabet({ cols: 3, rows: 3 }).dimensions).toBe(9);
  });

  test("rejects an empty character set", () => {
    expect(() => buildAlphabet({ font: FONT, cell: CELL, zones: { cols: 2, rows: 2 }, chars: "", canvas: stubCanvas })).toThrow();
  });
});

describe("selectMostDistinct", () => {
  test("thins the set while keeping both tonal extremes", () => {
    const alphabet = blockAlphabet();
    const picked = selectMostDistinct(alphabet, 3);

    expect(picked.chars).toHaveLength(3);
    expect(picked.vectors).toHaveLength(3 * picked.dimensions);
    expect(picked.chars).toContain(" ");
    expect(picked.chars).toContain("█");
  });

  test("keeps each character paired with its own vector", () => {
    const alphabet = blockAlphabet();
    const picked = selectMostDistinct(alphabet, 4);

    for (const char of picked.chars) {
      expect(vectorOf(picked, char)).toEqual(vectorOf(alphabet, char));
    }
  });

  test("is a no-op when the alphabet is already small enough", () => {
    const alphabet = blockAlphabet();
    expect(selectMostDistinct(alphabet, alphabet.chars.length + 5)).toBe(alphabet);
  });
});

describe("CharacterMatcher", () => {
  test("returns the character whose shape vector is nearest", () => {
    const alphabet = blockAlphabet();
    const matcher = new CharacterMatcher(alphabet);

    expect(matcher.match([0, 0, 0, 0])).toBe(" ");
    expect(matcher.match([1, 1, 1, 1])).toBe("█");
    expect(matcher.match([1, 1, 0, 0])).toBe("▀");
    expect(matcher.match([1, 0, 1, 0])).toBe("▌");
  });

  test("caching does not change which character is chosen", () => {
    const alphabet = blockAlphabet();
    const cached = new CharacterMatcher(alphabet, { cache: true });
    const uncached = new CharacterMatcher(alphabet, { cache: false });

    // Values are deliberately spread across quantization buckets.
    for (let i = 0; i <= 20; i++) {
      const v = [i / 20, 1 - i / 20, (i % 7) / 7, (i % 3) / 3];
      expect(cached.match(v)).toBe(uncached.match(v));
      expect(cached.match(v)).toBe(cached.match(v));
    }
  });

  test("excludes characters on request", () => {
    const alphabet = blockAlphabet();
    const matcher = new CharacterMatcher(alphabet, { exclude: "█" });

    expect(matcher.characters).not.toContain("█");
    expect(matcher.match([1, 1, 1, 1])).not.toBe("█");
  });

  test("rejects excluding everything", () => {
    const alphabet = blockAlphabet();
    expect(() => new CharacterMatcher(alphabet, { exclude: STUB_CHARS.join("") })).toThrow();
  });
});

describe("sampleFrame", () => {
  const layout = blockAlphabet().layout;
  const grid = { cols: 1, rows: 1, cellWidth: 16, cellHeight: 32, originX: 0, originY: 0 };

  test("reads a uniform frame as a uniform vector", () => {
    const frame = makeFrame(16, 32, () => 255);
    const { vectors } = sampleFrame(frame, layout, grid, { quality: 9 });

    for (const value of vectors) expect(value).toBeCloseTo(1, 2);
  });

  test("separates a frame's zones by brightness", () => {
    const frame = makeFrame(16, 32, (_x, y) => (y < 16 ? 255 : 0));
    const { vectors } = sampleFrame(frame, layout, grid, { quality: 9 });

    expect(vectors[0]).toBeCloseTo(1, 2);
    expect(vectors[1]).toBeCloseTo(1, 2);
    expect(vectors[2]).toBeCloseTo(0, 2);
    expect(vectors[3]).toBeCloseTo(0, 2);
  });

  test("global crunch exaggerates within-cell contrast but leaves flat cells alone", () => {
    const frame = makeFrame(16, 32, (_x, y) => (y < 16 ? 255 : 128));

    const plain = sampleFrame(frame, layout, grid, { quality: 9 });
    const crunched = sampleFrame(frame, layout, grid, { quality: 9, globalCrunch: 3 });

    // The brightest zone is the reference point, so it is unchanged.
    expect(crunched.vectors[0]).toBeCloseTo(plain.vectors[0]!, 4);
    expect(crunched.vectors[2]!).toBeLessThan(plain.vectors[2]!);

    const flat = makeFrame(16, 32, () => 128);
    const flatPlain = sampleFrame(flat, layout, grid, { quality: 9 });
    const flatCrunched = sampleFrame(flat, layout, grid, { quality: 9, globalCrunch: 3 });
    for (let i = 0; i < flatPlain.vectors.length; i++) {
      expect(flatCrunched.vectors[i]).toBeCloseTo(flatPlain.vectors[i]!, 4);
    }
  });

  test("directional crunch darkens only the zones facing a brighter neighbour", () => {
    // A uniformly mid-grey cell with a bright band past its right edge. The
    // band starts at x=22, within reach of the right-edge circles (centred at
    // x=19.7) but clear of the top and bottom ones (which stop at x=18.6).
    const frame = makeFrame(48, 32, (x) => (x >= 22 ? 255 : 100));
    const cell = { cols: 1, rows: 1, cellWidth: 16, cellHeight: 32, originX: 0, originY: 0 };

    const plain = sampleFrame(frame, layout, cell, { quality: 9 });
    const crunched = sampleFrame(frame, layout, cell, { quality: 9, directionalCrunch: 3 });

    // Nothing inside the cell varies, so global crunch would be a no-op here;
    // only the external circles can tell that an edge is nearby.
    expect(new Set(Array.from(plain.vectors).map((v) => v.toFixed(3))).size).toBe(1);

    // Zones 1 and 3 form the right column and are the only ones reached by the
    // right-hand external circles.
    expect(crunched.vectors[1]!).toBeLessThan(plain.vectors[1]!);
    expect(crunched.vectors[3]!).toBeLessThan(plain.vectors[3]!);
    expect(crunched.vectors[0]!).toBeCloseTo(plain.vectors[0]!, 6);
    expect(crunched.vectors[2]!).toBeCloseTo(plain.vectors[2]!, 6);
  });

  test("collects per-cell colour when asked", () => {
    const frame = makeFrame(16, 32, () => 0);
    for (let i = 0; i < 16 * 32; i++) {
      frame.data[i * 4] = 200;
      frame.data[i * 4 + 1] = 100;
      frame.data[i * 4 + 2] = 50;
    }

    const { colors } = sampleFrame(frame, layout, grid, { quality: 9, color: true });
    expect(colors).toBeDefined();
    expect(Array.from(colors!.subarray(0, 3))).toEqual([200, 100, 50]);
  });

  test("flipY reads the buffer from the bottom up", () => {
    const frame = makeFrame(16, 32, (_x, y) => (y < 16 ? 255 : 0));
    const upright = sampleFrame(frame, layout, grid, { quality: 9 });
    const flipped = sampleFrame(frame, layout, grid, { quality: 9, flipY: true });

    expect(upright.vectors[0]).toBeCloseTo(1, 2);
    expect(flipped.vectors[0]).toBeCloseTo(0, 2);
  });
});

describe("imageToAscii", () => {
  test("recovers the block a frame was drawn from", () => {
    const alphabet = blockAlphabet();
    const frame = makeFrame(8, 16, (_x, y) => (y < 8 ? 255 : 0));

    const result = imageToAscii(frame, alphabet, { cols: 1, quality: 9 });
    expect(result.cols).toBe(1);
    expect(result.rows).toBe(1);
    expect(result.chars).toEqual(["▀"]);
  });

  test("resolves a left/right split, which needs horizontal zones", () => {
    const alphabet = blockAlphabet();
    const frame = makeFrame(8, 16, (x) => (x < 4 ? 255 : 0));

    expect(imageToAscii(frame, alphabet, { cols: 1, quality: 9 }).chars).toEqual(["▌"]);
  });

  test("lays out a grid of cells in row-major order", () => {
    const alphabet = blockAlphabet();
    // Left half white, right half black, across a 4x2 character grid.
    const frame = makeFrame(32, 32, (x) => (x < 16 ? 255 : 0));

    const result = imageToAscii(frame, alphabet, { cols: 4, quality: 9 });
    expect(result.cols).toBe(4);
    expect(result.rows).toBe(2);
    expect(result.chars).toHaveLength(8);
    expect(toText(result)).toBe("██  \n██  ");
  });

  test("reuses a supplied matcher across frames", () => {
    const alphabet = blockAlphabet();
    const matcher = new CharacterMatcher(alphabet);
    const frame = makeFrame(8, 16, () => 255);

    const first = imageToAscii(frame, alphabet, { cols: 1, matcher });
    const second = imageToAscii(frame, alphabet, { cols: 1, matcher });
    expect(second.chars).toEqual(first.chars);
  });
});

describe("computeGrid", () => {
  test("keeps the alphabet's cell aspect so glyphs are not stretched", () => {
    const alphabet = blockAlphabet();
    const frame = makeFrame(200, 100, () => 0);

    const grid = computeGrid(frame, alphabet, { cols: 50 });
    expect(grid.cellWidth).toBeCloseTo(4, 6);
    expect(grid.cellHeight / grid.cellWidth).toBeCloseTo(CELL.height / CELL.width, 6);
    expect(grid.rows).toBe(Math.floor(100 / grid.cellHeight));
  });

  test("centres the grid, splitting any leftover pixels", () => {
    const alphabet = blockAlphabet();
    const frame = makeFrame(100, 100, () => 0);

    const grid = computeGrid(frame, alphabet, { cols: 10 });
    expect(grid.originX).toBeCloseTo(0, 6);
    expect(grid.originY).toBeCloseTo((100 - grid.rows * grid.cellHeight) / 2, 6);
    expect(grid.originY).toBeGreaterThanOrEqual(0);
  });

  test("never collapses to a zero-sized grid", () => {
    const alphabet = blockAlphabet();
    const grid = computeGrid(makeFrame(2, 2, () => 0), alphabet, {});
    expect(grid.cols).toBeGreaterThanOrEqual(1);
    expect(grid.rows).toBeGreaterThanOrEqual(1);
  });
});
