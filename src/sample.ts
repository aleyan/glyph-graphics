import { unitDiskSamples } from "./layout";
import { lightness } from "./raster";
import type { Frame, SamplingLayout } from "./types";

/** Where the character grid sits within a frame, in pixels. */
export interface GridGeometry {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  originX: number;
  originY: number;
}

export interface SampleOptions {
  /** Taps per sampling circle. More is smoother; 3-9 covers most uses. */
  quality?: number;
  /**
   * Exponent for global contrast enhancement. Pushes a cell's dimmer zones
   * toward zero while leaving its brightest alone, which sharpens the shape
   * within a cell. 1 disables it.
   */
  globalCrunch?: number;
  /**
   * Exponent for directional contrast enhancement, measured against the
   * external circles. Where a neighbour is brighter than this cell, the
   * boundary between them gets pushed apart. 1 disables it.
   */
  directionalCrunch?: number;
  /** Set when the pixel buffer's origin is bottom-left, as with `readPixels`. */
  flipY?: boolean;
  /** Also accumulate an average RGB per cell. */
  color?: boolean;
}

export interface SampleResult {
  /** Row-major, `dimensions` values per cell. */
  vectors: Float32Array;
  /** Row-major RGB triplets, present only when `color` was requested. */
  colors?: Uint8Array;
  dimensions: number;
}

/**
 * Reduces a frame to one sampling vector per character cell.
 *
 * Each vector holds the average lightness under each internal circle, after
 * optional contrast enhancement. It lives in the same space as the alphabet's
 * shape vectors, so the two can be compared directly.
 */
export function sampleFrame(
  frame: Frame,
  layout: SamplingLayout,
  grid: GridGeometry,
  options: SampleOptions = {},
): SampleResult {
  const {
    quality = 5,
    globalCrunch = 1,
    directionalCrunch = 1,
    flipY = false,
    color = false,
  } = options;

  const { cols, rows, cellWidth, cellHeight, originX, originY } = grid;
  const dimensions = layout.points.length;
  const externalCount = layout.external.length;

  const vectors = new Float32Array(cols * rows * dimensions);
  const colors = color ? new Uint8Array(cols * rows * 3) : undefined;

  const taps = unitDiskSamples(quality);
  const radiusPx = layout.radius * cellWidth;

  // Offsets are constant per cell, so resolve them to pixels once.
  const pointOffsets = layout.points.map((p) => [p.x * cellWidth, p.y * cellHeight] as const);
  const externalOffsets = layout.external.map(
    (p) => [p.x * cellWidth, p.y * cellHeight] as const,
  );

  const external = new Float32Array(externalCount);
  const rgb = new Float32Array(3);
  const useDirectional = directionalCrunch !== 1 && externalCount > 0;
  const useGlobal = globalCrunch !== 1;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellX = originX + col * cellWidth;
      const cellY = originY + row * cellHeight;
      const base = (row * cols + col) * dimensions;

      for (let i = 0; i < dimensions; i++) {
        const offset = pointOffsets[i];
        if (!offset) continue;
        vectors[base + i] = sampleCircle(
          frame,
          cellX + offset[0],
          cellY + offset[1],
          radiusPx,
          taps,
          flipY,
          color ? rgb : undefined,
        );
      }

      if (colors) {
        // The circles already cover the cell, so their mean colour is a fair
        // stand-in for the cell's colour without a second pass over the pixels.
        const c = (row * cols + col) * 3;
        colors[c] = clamp255((rgb[0] ?? 0) / dimensions);
        colors[c + 1] = clamp255((rgb[1] ?? 0) / dimensions);
        colors[c + 2] = clamp255((rgb[2] ?? 0) / dimensions);
        rgb.fill(0);
      }

      if (useDirectional) {
        for (let i = 0; i < externalCount; i++) {
          const offset = externalOffsets[i];
          if (!offset) continue;
          external[i] = sampleCircle(
            frame,
            cellX + offset[0],
            cellY + offset[1],
            radiusPx,
            taps,
            flipY,
            undefined,
          );
        }
        crunchDirectional(vectors, base, dimensions, external, layout.affectedBy, directionalCrunch);
      }

      if (useGlobal) crunchGlobal(vectors, base, dimensions, globalCrunch);
    }
  }

  return { vectors, colors, dimensions };
}

function sampleCircle(
  frame: Frame,
  centerX: number,
  centerY: number,
  radius: number,
  taps: readonly { x: number; y: number }[],
  flipY: boolean,
  rgb: Float32Array | undefined,
): number {
  const { data, width, height } = frame;
  let total = 0;

  for (const tap of taps) {
    const sampleX = centerX + tap.x * radius;
    const sampleY = centerY + tap.y * radius;

    const px = clampInt(Math.floor(sampleX), 0, width - 1);
    const py = clampInt(Math.floor(flipY ? height - sampleY : sampleY), 0, height - 1);
    const i = (py * width + px) * 4;

    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    total += lightness(r, g, b);

    if (rgb) {
      rgb[0] = (rgb[0] ?? 0) + r / taps.length;
      rgb[1] = (rgb[1] ?? 0) + g / taps.length;
      rgb[2] = (rgb[2] ?? 0) + b / taps.length;
    }
  }

  return total / taps.length;
}

/**
 * Raises each component toward zero relative to the cell's own maximum. The
 * vector is normalized before the exponent and rescaled after, so a uniformly
 * bright cell stays bright and only internal differences are exaggerated.
 */
function crunchGlobal(
  vectors: Float32Array,
  base: number,
  dimensions: number,
  exponent: number,
): void {
  let max = 0;
  for (let i = 0; i < dimensions; i++) max = Math.max(max, vectors[base + i] ?? 0);
  if (max === 0) return;
  for (let i = 0; i < dimensions; i++) {
    vectors[base + i] = Math.pow((vectors[base + i] ?? 0) / max, exponent) * max;
  }
}

/**
 * The same crunch, but each component is measured against the brightest
 * external circle that reaches it rather than against the cell's own maximum.
 *
 * This is what carries edges across cell boundaries: a dark component sitting
 * beside a bright neighbour is darkened further, so the chosen character leans
 * away from the edge and the boundary stays crisp.
 */
function crunchDirectional(
  vectors: Float32Array,
  base: number,
  dimensions: number,
  external: Float32Array,
  affectedBy: number[][],
  exponent: number,
): void {
  for (let i = 0; i < dimensions; i++) {
    const value = vectors[base + i] ?? 0;

    let reference = 0;
    for (const index of affectedBy[i] ?? []) {
      reference = Math.max(reference, external[index] ?? 0);
    }

    // A neighbour that is no brighter than this component says nothing about
    // where the edge is, so leave the component alone.
    if (reference <= value) continue;
    vectors[base + i] = Math.pow(value / reference, exponent) * reference;
  }
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}
