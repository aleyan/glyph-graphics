export { buildAlphabet, deserializeAlphabet, serializeAlphabet } from "./alphabet.js";
export type { BuildAlphabetOptions } from "./alphabet.js";

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
