import { describe, expect, test } from "bun:test";
import { buildAlphabet } from "../src/alphabet";
import { buildGlyphAtlas, packColors, packGlyphIndices } from "../src/three/atlas";
import type { AsciiFrame } from "../src/types";
import { stubCanvas, tiledStubCanvas, STUB_CHARS } from "./stubCanvas";

const CELL = { width: 8, height: 16 };

function blockAlphabet() {
  return buildAlphabet({
    font: { family: "stub", size: 16 },
    cell: CELL,
    zones: { cols: 2, rows: 2 },
    chars: STUB_CHARS,
    canvas: stubCanvas,
    supersample: 1,
    blur: 0,
    glyphScale: 1,
    baseline: 0.5,
  });
}

describe("buildGlyphAtlas", () => {
  test("packs every character into a near-square tile grid", () => {
    const alphabet = blockAlphabet();
    const atlas = buildGlyphAtlas(alphabet, { canvas: stubCanvas });

    expect(atlas.chars).toEqual(alphabet.chars);
    expect(atlas.cols * atlas.rows).toBeGreaterThanOrEqual(alphabet.chars.length);
    // Near-square: neither dimension more than one tile past the square root.
    expect(atlas.cols).toBe(Math.ceil(Math.sqrt(alphabet.chars.length)));
    expect(atlas.width).toBe(atlas.cols * atlas.tileWidth);
    expect(atlas.height).toBe(atlas.rows * atlas.tileHeight);
    expect(atlas.coverage.length).toBe(atlas.width * atlas.height);
  });

  test("maps each character to its own tile", () => {
    const alphabet = blockAlphabet();
    const atlas = buildGlyphAtlas(alphabet, { canvas: stubCanvas });

    alphabet.chars.forEach((char, i) => expect(atlas.index.get(char)).toBe(i));
  });

  test("rasterizes coverage that matches each glyph's ink", () => {
    const alphabet = blockAlphabet();
    // The atlas draws each glyph into its own tile, so the canvas must honour
    // the draw anchor rather than mapping every glyph to the whole surface.
    const atlas = buildGlyphAtlas(alphabet, {
      canvas: tiledStubCanvas(CELL.width, CELL.height, 0.5),
      glyphScale: 1,
      baseline: 0.5,
    });

    const meanCoverage = (char: string): number => {
      const tile = atlas.index.get(char)!;
      const tx = (tile % atlas.cols) * atlas.tileWidth;
      const ty = Math.floor(tile / atlas.cols) * atlas.tileHeight;
      let sum = 0;
      for (let y = 0; y < atlas.tileHeight; y++) {
        for (let x = 0; x < atlas.tileWidth; x++) {
          sum += atlas.coverage[(ty + y) * atlas.width + (tx + x)] ?? 0;
        }
      }
      return sum / (atlas.tileWidth * atlas.tileHeight * 255);
    };

    expect(meanCoverage(" ")).toBeCloseTo(0, 5);
    expect(meanCoverage("█")).toBeCloseTo(1, 5);
    expect(meanCoverage("▀")).toBeCloseTo(0.5, 1);
    expect(meanCoverage("▌")).toBeCloseTo(0.5, 1);
  });

  test("respects a custom tile size", () => {
    const alphabet = blockAlphabet();
    const atlas = buildGlyphAtlas(alphabet, { canvas: stubCanvas, tile: { width: 20, height: 40 } });
    expect(atlas.tileWidth).toBe(20);
    expect(atlas.tileHeight).toBe(40);
  });
});

describe("packGlyphIndices", () => {
  const alphabet = blockAlphabet();
  const atlas = buildGlyphAtlas(alphabet, { canvas: stubCanvas });

  test("encodes each cell's glyph index across the low and high bytes", () => {
    const frame: AsciiFrame = { cols: 2, rows: 1, chars: ["█", " "] };
    const data = packGlyphIndices(frame, atlas);

    const full = atlas.index.get("█")!;
    expect(data[0]).toBe(full & 0xff);
    expect(data[1]).toBe((full >> 8) & 0xff);
    expect(data[3]).toBe(255);

    expect(data[4]).toBe(atlas.index.get(" ")! & 0xff);
  });

  test("falls back to index 0 for characters absent from the atlas", () => {
    const frame: AsciiFrame = { cols: 1, rows: 1, chars: ["Ω"] };
    const data = packGlyphIndices(frame, atlas);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
  });

  test("round-trips a large index through both bytes", () => {
    // Synthesize an atlas index past 255 to exercise the high byte.
    const bigAtlas = { ...atlas, index: new Map([["x", 300]]) };
    const data = packGlyphIndices({ cols: 1, rows: 1, chars: ["x"] }, bigAtlas);
    expect(data[0]! + data[1]! * 256).toBe(300);
  });
});

describe("packColors", () => {
  test("passes per-cell colour through when present", () => {
    const frame: AsciiFrame = {
      cols: 2,
      rows: 1,
      chars: ["a", "b"],
      colors: new Uint8Array([10, 20, 30, 200, 100, 50]),
    };
    const data = packColors(frame);
    expect(Array.from(data.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(data.subarray(4, 8))).toEqual([200, 100, 50, 255]);
  });

  test("defaults to opaque white when the frame has no colour", () => {
    const frame: AsciiFrame = { cols: 1, rows: 1, chars: ["a"] };
    expect(Array.from(packColors(frame))).toEqual([255, 255, 255, 255]);
  });
});
