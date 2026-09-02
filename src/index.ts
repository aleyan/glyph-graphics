import {
  buildAlphabet as buildCustomAlphabet,
  type BuildAlphabetOptions as BuildCustomAlphabetOptions,
} from "./alphabet.js";
import {
  alexHarriAlgorithm,
  buildAlexHarriAlphabet,
  type AlexHarriOptions,
  type BuildAlexHarriAlphabetOptions,
} from "./harri.js";
import type { Alphabet, AsciiFrame, Frame } from "./types.js";

/**
 * Alphabet options for either the standard Harri geometry or an explicitly
 * configured cell and sampling layout.
 */
export type BuildAlphabetOptions =
  | BuildAlexHarriAlphabetOptions
  | BuildCustomAlphabetOptions;

/**
 * Measure a glyph palette. Omitting `cell` and `zones` uses the published
 * Harri geometry; supplying them enables the configurable pipeline.
 */
export function buildAlphabet(options: BuildAlphabetOptions): Alphabet {
  if ("cell" in options || "zones" in options) {
    if (!("cell" in options) || !("zones" in options)) {
      throw new Error("Custom alphabet measurement requires both `cell` and `zones`");
    }
    return buildCustomAlphabet(options as BuildCustomAlphabetOptions);
  }
  return buildAlexHarriAlphabet(options);
}

/** Convert one row-major RGBA frame with the standard Harri comparator. */
export function convert(
  frame: Frame,
  alphabet: Alphabet,
  options?: AlexHarriOptions,
): AsciiFrame {
  return alexHarriAlgorithm.convert(frame, alphabet, options);
}

export { deserializeAlphabet, serializeAlphabet } from "./alphabet.js";

export { buildLayout, unitDiskSamples } from "./layout.js";
export type { LayoutOptions } from "./layout.js";

export { computeGrid, imageToAscii, toText } from "./convert.js";
export type { ConvertOptions } from "./convert.js";

export { sampleFrame } from "./sample.js";
export type { GridGeometry, SampleOptions, SampleResult } from "./sample.js";

export { CharacterMatcher } from "./matcher.js";
export type { MatcherOptions } from "./matcher.js";

export { KdTree } from "./kdtree.js";
export type { NearestResult } from "./kdtree.js";

export { selectMostDistinct } from "./select.js";

export {
  circleLightness,
  defaultCanvasFactory,
  fontShorthand,
  lightness,
  rasterizeGlyph,
} from "./raster.js";
export type {
  CanvasFactory,
  CanvasLike,
  Context2DLike,
  FontSpec,
  GlyphRasterOptions,
} from "./raster.js";

export * as charsets from "./charsets.js";

export {
  ALEX_HARRI_CELL,
  ALEX_HARRI_LAYOUT,
  ALEX_HARRI_ZONES,
  alexHarriAlgorithm,
  buildAlexHarriAlphabet,
} from "./harri.js";
export type {
  AlexHarriAlgorithm,
  AlexHarriOptions,
  BuildAlexHarriAlphabetOptions,
} from "./harri.js";

export type {
  Alphabet,
  AsciiFrame,
  CellSize,
  ExternalSamplePoint,
  Frame,
  SamplePoint,
  SamplingLayout,
  SerializedAlphabet,
  ZoneGrid,
} from "./types.js";
