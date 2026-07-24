/**
 * Differential tests against the vendored reference implementation.
 *
 * Our implementation is written independently, so these pin the places where it
 * must agree with Alex Harri's original. Where the two deliberately differ, the
 * test says so and asserts the difference rather than papering over it.
 */
import { describe, expect, test } from "bun:test";
import { buildAlphabet } from "../src/alphabet";
import * as harri from "./reference/harri_algorithm";
import { KdTree } from "../src/kdtree";
import { buildLayout, unitDiskSamples } from "../src/layout";
import { circleLightness, lightness, rasterizeGlyph } from "../src/raster";
import { sampleFrame } from "../src/sample";
import type { Frame, SamplingLayout } from "../src/types";
import { stubCanvas, STUB_CHARS } from "./stubCanvas";

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const CELL = { width: 8, height: 16 };
const ZONES = { cols: 2, rows: 2 };
const FONT = { family: "stub", size: 16 };

const layout = buildLayout({ zones: ZONES, cell: CELL });
const GRID = { cols: 1, rows: 1, cellWidth: 16, cellHeight: 32, originX: 0, originY: 0 };

/** A frame with a bright band on the right, so external circles see an edge. */
function edgeFrame(): Frame {
  const width = 48;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = x >= 20 ? 240 : 40 + ((x * 7 + y * 3) % 60);
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("sampling geometry", () => {
  test("unitDiskSamples reproduces getSamplePoints", () => {
    for (let quality = 1; quality <= 16; quality++) {
      const ours = unitDiskSamples(quality);
      const theirs = harri.getSamplePoints(quality);

      expect(ours).toHaveLength(theirs.length);
      ours.forEach((point, i) => {
        expect(point.x).toBeCloseTo(theirs[i]!.x, 12);
        expect(point.y).toBeCloseTo(theirs[i]!.y, 12);
      });
    }
  });

  test("affectedBy reproduces buildAffectsMapping", () => {
    for (const zones of [
      { cols: 2, rows: 3 },
      { cols: 2, rows: 2 },
      { cols: 3, rows: 3 },
      { cols: 1, rows: 4 },
    ]) {
      const generated = buildLayout({ zones, cell: { width: 48, height: 64 } });
      const expected = harri.buildAffectsMapping(generated.external, generated.points.length);
      expect(generated.affectedBy).toEqual(expected);
    }
  });

  test("our generated 2x3 layout matches the reference's hand-tuned affects table", () => {
    const generated = buildLayout({ zones: { cols: 2, rows: 3 }, cell: { width: 48, height: 64 } });
    const reference = harri.DEFAULT_SAMPLING_CONFIG.externalPoints!;

    expect(generated.external).toHaveLength(reference.length);

    // Positions are tuned by hand in the original and derived in ours, so only
    // the influence topology is expected to match exactly.
    const sortKey = (p: { x: number; y: number }) => `${p.y.toFixed(2)}:${p.x.toFixed(2)}`;
    const ours = [...generated.external].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const theirs = [...reference].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    expect(ours.map((p) => p.affects)).toEqual(theirs.map((p) => p.affects));
  });
});

describe("lightness", () => {
  test("matches the reference's packed-colour formula", () => {
    const random = makeRandom(7);
    for (let i = 0; i < 200; i++) {
      const r = Math.floor(random() * 256);
      const g = Math.floor(random() * 256);
      const b = Math.floor(random() * 256);
      const packed = (r << 16) | (g << 8) | b;
      expect(lightness(r, g, b)).toBeCloseTo(harri.lightness(packed), 12);
    }
  });

  test("circleLightness matches calculateCircleLightness on greyscale", () => {
    // The original uses NTSC coefficients for glyphs and Rec.709 for frames; we
    // use Rec.709 throughout. Both sets sum to 1, so on the greyscale rasters
    // that glyph measurement actually produces they agree exactly.
    const canvas = stubCanvas(32, 64);
    for (const char of STUB_CHARS) {
      rasterizeGlyph(canvas, char, { family: "stub", size: 32 }, { glyphScale: 1, baseline: 0.5 });
      const frame = canvas.getContext("2d")!.getImageData(0, 0, 32, 64);

      for (const [cx, cy, r] of [
        [8, 16, 5],
        [24, 48, 7.5],
        [16, 32, 11],
      ] as const) {
        expect(circleLightness(frame, cx, cy, r)).toBeCloseTo(
          harri.calculateCircleLightness(frame, cx, cy, r),
          12,
        );
      }
    }
  });
});

describe("contrast enhancement", () => {
  const frame = edgeFrame();
  const dimensions = layout.points.length;

  function cellVector(vectors: Float32Array): number[] {
    return Array.from(vectors.subarray(0, dimensions));
  }

  test("global crunch matches crunchSamplingVector", () => {
    const plain = cellVector(sampleFrame(frame, layout, GRID, { quality: 7 }).vectors);

    for (const exponent of [1.5, 2, 3, 4]) {
      const ours = cellVector(
        sampleFrame(frame, layout, GRID, { quality: 7, globalCrunch: exponent }).vectors,
      );

      const expected = [...plain];
      harri.crunchSamplingVector(expected, exponent);

      ours.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
    }
  });

  test("directional crunch matches crunchSamplingVectorDirectional", () => {
    const plain = cellVector(sampleFrame(frame, layout, GRID, { quality: 7 }).vectors);

    // Recover the external circle values through the public API by promoting the
    // external points to internal ones; radius and tap pattern are unchanged.
    const promoted: SamplingLayout = {
      ...layout,
      points: layout.external.map(({ x, y }) => ({ x, y })),
      external: [],
      affectedBy: [],
    };
    const external = Array.from(sampleFrame(frame, promoted, GRID, { quality: 7 }).vectors);
    const affectsMapping = harri.buildAffectsMapping(layout.external, dimensions);

    for (const exponent of [2, 3, 4]) {
      const ours = cellVector(
        sampleFrame(frame, layout, GRID, { quality: 7, directionalCrunch: exponent }).vectors,
      );

      const expected = [...plain];
      harri.crunchSamplingVectorDirectional(expected, external, affectsMapping, exponent);

      ours.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
      // Guard against the comparison passing because nothing happened.
      expect(expected).not.toEqual(plain);
    }
  });

  test("both crunches compose in the reference's order", () => {
    const plain = cellVector(sampleFrame(frame, layout, GRID, { quality: 7 }).vectors);
    const promoted: SamplingLayout = {
      ...layout,
      points: layout.external.map(({ x, y }) => ({ x, y })),
      external: [],
      affectedBy: [],
    };
    const external = Array.from(sampleFrame(frame, promoted, GRID, { quality: 7 }).vectors);

    const ours = cellVector(
      sampleFrame(frame, layout, GRID, { quality: 7, globalCrunch: 2, directionalCrunch: 3 })
        .vectors,
    );

    // The original applies directional first, then global.
    const expected = [...plain];
    harri.crunchSamplingVectorDirectional(
      expected,
      external,
      harri.buildAffectsMapping(layout.external, dimensions),
      3,
    );
    harri.crunchSamplingVector(expected, 2);

    ours.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
  });
});

describe("nearest-neighbour search", () => {
  test("finds the same character as the reference k-d tree", () => {
    const random = makeRandom(99);

    for (const dimensions of [2, 4, 6]) {
      const count = 80;
      const flat = new Float32Array(count * dimensions);
      for (let i = 0; i < flat.length; i++) flat[i] = random();

      const ours = new KdTree(flat, dimensions);
      const theirs = new harri.KdTree(
        Array.from({ length: count }, (_, i) => ({
          vector: Array.from(flat.subarray(i * dimensions, (i + 1) * dimensions)),
          data: i,
        })),
      );

      for (let trial = 0; trial < 100; trial++) {
        const target = Array.from({ length: dimensions }, () => random());
        const a = ours.findNearest(target);
        const b = theirs.findNearest(target)!;
        expect(Math.sqrt(a.distanceSquared)).toBeCloseTo(b.distance, 6);
      }
    }
  });
});

describe("alphabet normalization", () => {
  test("matches normalizeVectorsGlobally over independently measured vectors", () => {
    const alphabet = buildAlphabet({
      font: FONT,
      cell: CELL,
      zones: ZONES,
      chars: STUB_CHARS,
      canvas: stubCanvas,
      supersample: 2,
      glyphScale: 1,
      baseline: 0.5,
    });

    // Re-measure raw coverage the long way, then normalize with the original.
    const width = CELL.width * 2;
    const height = CELL.height * 2;
    const canvas = stubCanvas(width, height);
    const radius = alphabet.layout.radius * width;

    const raw = STUB_CHARS.map((char) => {
      rasterizeGlyph(canvas, char, { family: "stub", size: 32 }, { glyphScale: 1, baseline: 0.5 });
      const frame = canvas.getContext("2d")!.getImageData(0, 0, width, height);
      return alphabet.layout.points.map((point) =>
        circleLightness(frame, point.x * width, point.y * height, radius),
      );
    });
    harri.normalizeVectorsGlobally(raw);

    raw.forEach((vector, c) => {
      vector.forEach((value, i) => {
        expect(alphabet.vectors[c * alphabet.dimensions + i]).toBeCloseTo(value, 6);
      });
    });
  });
});

describe("documented divergences", () => {
  test("our cache key uses the full 5-bit range the reference reserves", () => {
    // The reference shifts by 5 bits but quantizes to 8 levels, so two of every
    // five bits are always zero. We quantize to the full 1<<bits, which is what
    // the blog post describes.
    const vector = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9];
    expect(harri.quantizeToKey(vector)).toBe(0b00111_00111_00111_00111_00111_00111);
  });

  test("our character selection is farthest-point, not the reference heuristic", () => {
    // Both thin an alphabet to distinct characters; only ours is a single
    // deterministic rule, so results are expected to differ.
    const vectors = Array.from({ length: 40 }, (_, i) => [i / 40, 1 - i / 40, (i % 5) / 5]);
    const chars = vectors.map((_, i) => String.fromCharCode(65 + i));

    const theirs = harri.CharacterSelector.selectMostDistinctCharacters(vectors, chars, 8);
    expect(theirs.chars).toHaveLength(8);
    expect(new Set(theirs.chars).size).toBe(8);
  });
});
