import { buildAlphabet, type BuildAlphabetOptions } from "./alphabet";
import { computeGrid, type ConvertOptions } from "./convert";
import { sampleFrame } from "./sample";
import type { Alphabet, AsciiFrame, Frame, SamplingLayout } from "./types";

/** Alex Harri Jónsson's published reference cell dimensions. */
export const ALEX_HARRI_CELL = Object.freeze({ width: 48, height: 64 });

/** The six-dimensional sampling grid used by the published renderer. */
export const ALEX_HARRI_ZONES = Object.freeze({ cols: 2, rows: 3 });

/**
 * The hand-tuned six internal and ten external sample positions from Alex
 * Harri Jónsson's MIT-licensed renderer.
 *
 * Source: https://github.com/alexharri/website
 * Description: https://alexharri.com/blog/ascii-rendering
 */
export const ALEX_HARRI_LAYOUT: SamplingLayout = Object.freeze({
  zones: ALEX_HARRI_ZONES,
  points: Object.freeze([
    Object.freeze({ x: 0.3, y: 0.23 }),
    Object.freeze({ x: 0.7, y: 0.18 }),
    Object.freeze({ x: 0.3, y: 0.5 }),
    Object.freeze({ x: 0.7, y: 0.5 }),
    Object.freeze({ x: 0.3, y: 0.82 }),
    Object.freeze({ x: 0.7, y: 0.77 }),
  ]),
  external: Object.freeze([
    Object.freeze({ x: 0.07, y: -0.21, affects: Object.freeze([0, 1]) }),
    Object.freeze({ x: 0.93, y: -0.21, affects: Object.freeze([0, 1]) }),
    Object.freeze({ x: -0.25, y: 0.07, affects: Object.freeze([0, 2]) }),
    Object.freeze({ x: 1.25, y: 0.07, affects: Object.freeze([1, 3]) }),
    Object.freeze({ x: -0.25, y: 0.5, affects: Object.freeze([0, 2, 4]) }),
    Object.freeze({ x: 1.25, y: 0.5, affects: Object.freeze([1, 3, 5]) }),
    Object.freeze({ x: -0.25, y: 0.93, affects: Object.freeze([2, 4]) }),
    Object.freeze({ x: 1.25, y: 0.93, affects: Object.freeze([3, 5]) }),
    Object.freeze({ x: 0.07, y: 1.21, affects: Object.freeze([4, 5]) }),
    Object.freeze({ x: 0.93, y: 1.21, affects: Object.freeze([4, 5]) }),
  ]),
  affectedBy: Object.freeze([
    Object.freeze([0, 1, 2, 4]),
    Object.freeze([0, 1, 3, 5]),
    Object.freeze([2, 4, 6]),
    Object.freeze([3, 5, 7]),
    Object.freeze([4, 6, 8, 9]),
    Object.freeze([5, 7, 8, 9]),
  ]),
  radius: 13.5 / ALEX_HARRI_CELL.width,
}) as SamplingLayout;

export type BuildAlexHarriAlphabetOptions = Omit<
  BuildAlphabetOptions,
  "cell" | "zones" | "layout" | "samplingLayout"
>;

/** Measure a caller-supplied palette with the exact published geometry. */
export function buildAlexHarriAlphabet(
  options: BuildAlexHarriAlphabetOptions,
): Alphabet {
  return buildAlphabet({
    ...options,
    cell: ALEX_HARRI_CELL,
    zones: ALEX_HARRI_ZONES,
    samplingLayout: ALEX_HARRI_LAYOUT,
  });
}

/** Conversion options supported by the exact Harri comparator. */
export type AlexHarriOptions = Omit<ConvertOptions, "matcher">;

export interface AlexHarriAlgorithm {
  readonly id: "alex-harri";
  readonly label: string;
  readonly description: string;
  convert(
    frame: Frame,
    alphabet: Alphabet,
    options?: AlexHarriOptions,
  ): AsciiFrame;
}

interface AsciiCandidate {
  index: number;
  char: string;
}

interface GlyphBank {
  candidates: AsciiCandidate[];
  vectors: Float32Array;
}

const MAX_ASCII_CANDIDATES = 49;
const EPSILON = 1e-12;
const glyphBanks = new WeakMap<Alphabet, GlyphBank>();

/**
 * Exact published-geometry comparator.
 *
 * The alphabet must come from `buildAlexHarriAlphabet` (or be a structurally
 * equivalent serialized alphabet). Keeping that invariant explicit prevents a
 * vector measured at one position from being compared with a different source
 * position.
 */
export const alexHarriAlgorithm: AlexHarriAlgorithm = {
  id: "alex-harri",
  label: "Alex Harri",
  description:
    "Nearest six-zone glyph vector using Alex Harri Jónsson's hand-tuned internal and external sampling geometry.",
  convert(frame, alphabet, options = {}): AsciiFrame {
    const bank = bankFor(alphabet);
    const excluded = new Set([...(options.exclude ?? "")]);
    const active = bank.candidates.filter(({ char }) => !excluded.has(char));
    if (active.length === 0) {
      throw new Error("The alphabet has no non-excluded printable ASCII candidates");
    }

    const grid = computeGrid(frame, alphabet, options);
    const sampled = sampleFrame(frame, ALEX_HARRI_LAYOUT, grid, options);
    const chars = new Array<string>(grid.cols * grid.rows);

    for (let cell = 0; cell < chars.length; cell++) {
      const sourceBase = cell * sampled.dimensions;
      let closest = active[0];
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const candidate of active) {
        let distance = 0;
        const glyphBase = candidate.index * sampled.dimensions;
        for (let dimension = 0; dimension < sampled.dimensions; dimension++) {
          const delta =
            (sampled.vectors[sourceBase + dimension] ?? 0) -
            (bank.vectors[glyphBase + dimension] ?? 0);
          distance += delta * delta;
        }
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = candidate;
        }
      }
      chars[cell] = closest?.char ?? " ";
    }

    return { cols: grid.cols, rows: grid.rows, chars, colors: sampled.colors };
  },
};

function bankFor(alphabet: Alphabet): GlyphBank {
  const cached = glyphBanks.get(alphabet);
  if (cached) return cached;

  if (!hasExactHarriGeometry(alphabet)) {
    throw new Error(
      "Alex Harri conversion requires an alphabet built with buildAlexHarriAlphabet",
    );
  }

  const requiredVectorLength =
    alphabet.chars.length * ALEX_HARRI_LAYOUT.points.length;
  if (alphabet.vectors.length < requiredVectorLength) {
    throw new Error(
      `Alex Harri matching needs ${requiredVectorLength} glyph-vector values; ` +
        `got ${alphabet.vectors.length}`,
    );
  }

  const candidates: AsciiCandidate[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < alphabet.chars.length; index++) {
    const char = alphabet.chars[index] ?? "";
    if (!isPrintableAscii(char) || seen.has(char)) continue;
    seen.add(char);
    candidates.push({ index, char });
    if (candidates.length > MAX_ASCII_CANDIDATES) {
      throw new Error(
        `The alphabet declares more than ${MAX_ASCII_CANDIDATES} unique printable ASCII candidates`,
      );
    }
  }
  if (candidates.length === 0) {
    throw new Error("The alphabet has no printable ASCII candidates");
  }

  const bank = { candidates, vectors: alphabet.vectors };
  glyphBanks.set(alphabet, bank);
  return bank;
}

function isPrintableAscii(char: string): boolean {
  if ([...char].length !== 1) return false;
  const code = char.codePointAt(0) ?? -1;
  return code >= 0x20 && code <= 0x7e;
}

function hasExactHarriGeometry(alphabet: Alphabet): boolean {
  const layout = alphabet.layout;
  if (
    alphabet.dimensions !== ALEX_HARRI_LAYOUT.points.length ||
    alphabet.cell.width !== ALEX_HARRI_CELL.width ||
    alphabet.cell.height !== ALEX_HARRI_CELL.height ||
    layout.zones.cols !== ALEX_HARRI_ZONES.cols ||
    layout.zones.rows !== ALEX_HARRI_ZONES.rows ||
    Math.abs(layout.radius - ALEX_HARRI_LAYOUT.radius) > EPSILON ||
    layout.points.length !== ALEX_HARRI_LAYOUT.points.length ||
    layout.external.length !== ALEX_HARRI_LAYOUT.external.length
  ) {
    return false;
  }

  const pointsMatch = layout.points.every((point, index) => {
    const expected = ALEX_HARRI_LAYOUT.points[index];
    return (
      expected !== undefined &&
      Math.abs(point.x - expected.x) <= EPSILON &&
      Math.abs(point.y - expected.y) <= EPSILON
    );
  });
  const externalMatch = layout.external.every((point, index) => {
    const expected = ALEX_HARRI_LAYOUT.external[index];
    return (
      expected !== undefined &&
      Math.abs(point.x - expected.x) <= EPSILON &&
      Math.abs(point.y - expected.y) <= EPSILON &&
      point.affects.length === expected.affects.length &&
      point.affects.every((affected, affectedIndex) =>
        affected === expected.affects[affectedIndex]
      )
    );
  });
  return pointsMatch && externalMatch;
}
