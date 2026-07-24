import { describe, expect, test } from "bun:test";
import { buildLayout, unitDiskSamples } from "../src/layout";

describe("buildLayout", () => {
  test("produces one internal point per zone, row-major", () => {
    const layout = buildLayout({ zones: { cols: 2, rows: 3 }, cell: { width: 40, height: 64 } });

    expect(layout.points).toHaveLength(6);
    const ys = layout.points.map((p) => p.y);
    expect(ys[0]).toBe(ys[1]!);
    expect(ys[0]).toBeLessThan(ys[2]!);
    expect(layout.points[0]!.x).toBeLessThan(layout.points[1]!.x);
  });

  test("insets zone centres symmetrically about the cell centre", () => {
    const layout = buildLayout({
      zones: { cols: 2, rows: 1 },
      cell: { width: 40, height: 40 },
      inset: 0.08,
    });

    const [left, right] = layout.points;
    expect(left!.x).toBeCloseTo(0.27, 6);
    expect(right!.x).toBeCloseTo(0.73, 6);
  });

  test("sizes circles from the smaller zone dimension so they stay round", () => {
    // 40x64 cell over a 2x3 grid gives 20x21.3 zones; the 20px axis governs.
    const layout = buildLayout({
      zones: { cols: 2, rows: 3 },
      cell: { width: 40, height: 64 },
      radiusScale: 0.93,
    });

    expect(layout.radius * 40).toBeCloseTo(9.3, 6);
  });

  test("rings the cell with external circles that reach their nearest zones", () => {
    const layout = buildLayout({ zones: { cols: 2, rows: 3 }, cell: { width: 48, height: 64 } });

    // Two per horizontal edge, three per vertical edge.
    expect(layout.external).toHaveLength(10);
    for (const point of layout.external) {
      const outside = point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1;
      expect(outside).toBe(true);
      expect(point.affects.length).toBeGreaterThan(0);
    }

    const above = layout.external.filter((p) => p.y < 0);
    expect(above.map((p) => p.affects)).toEqual([
      [0, 1],
      [0, 1],
    ]);

    // A circle at the middle of the left edge reaches that whole column, while
    // one at the corner reaches only the two zones nearest it.
    const left = layout.external.filter((p) => p.x < 0);
    expect(left.map((p) => p.affects)).toEqual([
      [0, 2],
      [0, 2, 4],
      [2, 4],
    ]);

    const right = layout.external.filter((p) => p.x > 1);
    expect(right.map((p) => p.affects)).toEqual([
      [1, 3],
      [1, 3, 5],
      [3, 5],
    ]);
  });

  test("affectedBy inverts the affects mapping", () => {
    const layout = buildLayout({ zones: { cols: 2, rows: 3 }, cell: { width: 48, height: 64 } });

    expect(layout.affectedBy).toHaveLength(6);
    layout.external.forEach((point, externalIndex) => {
      for (const internalIndex of point.affects) {
        expect(layout.affectedBy[internalIndex]).toContain(externalIndex);
      }
    });
    const referenced = new Set(layout.affectedBy.flat());
    expect(referenced.size).toBe(layout.external.length);
  });

  test("omits external circles when disabled", () => {
    const layout = buildLayout({
      zones: { cols: 2, rows: 2 },
      cell: { width: 10, height: 20 },
      external: false,
    });

    expect(layout.external).toHaveLength(0);
    expect(layout.affectedBy.every((list) => list.length === 0)).toBe(true);
  });

  test("rejects degenerate zone grids and cells", () => {
    expect(() => buildLayout({ zones: { cols: 0, rows: 2 }, cell: { width: 10, height: 10 } })).toThrow();
    expect(() => buildLayout({ zones: { cols: 2, rows: 2 }, cell: { width: 0, height: 10 } })).toThrow();
  });
});

describe("unitDiskSamples", () => {
  test("keeps every tap inside the unit disk", () => {
    for (const quality of [1, 2, 3, 4, 5, 9, 32]) {
      for (const { x, y } of unitDiskSamples(quality)) {
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(1);
      }
    }
  });

  test("returns exactly the requested number of taps", () => {
    for (const quality of [1, 2, 3, 4, 7, 16]) {
      expect(unitDiskSamples(quality)).toHaveLength(quality);
    }
  });

  test("spreads taps by equal area rather than clustering at the centre", () => {
    // With equal-area radii, half the taps should fall inside r = 1/sqrt(2).
    const samples = unitDiskSamples(1000);
    const inner = samples.filter(({ x, y }) => Math.hypot(x, y) <= Math.SQRT1_2).length;
    expect(inner / samples.length).toBeCloseTo(0.5, 1);
  });

  test("rejects a quality below one", () => {
    expect(() => unitDiskSamples(0)).toThrow();
  });
});
