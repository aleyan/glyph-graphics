/**
 * The original ASCII rendering algorithm by Alex Harri Jónsson.
 *
 *     Copyright (c) 2025 Alex Harri Jónsson
 *
 *     Permission is hereby granted, free of charge, to any person obtaining a copy of
 *     this software and associated documentation files (the "Software"), to deal in
 *     the Software without restriction, including without limitation the rights to
 *     use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 *     the Software, and to permit persons to whom the Software is furnished to do so,
 *     subject to the following conditions:
 *
 *     The above copyright notice and this permission notice shall be included in all
 *     copies or substantial portions of the Software.
 *
 *     THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *     IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 *     FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 *     COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 *     IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 *     CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Sources: https://github.com/alexharri/website (MIT), described in
 * https://alexharri.com/blog/ascii-rendering
 *
 * ---
 *
 * This test-only file is the reference implementation, kept for provenance and
 * used as a differential-testing oracle in `tests/differential.test.ts`. The rest of this
 * library is an independent implementation of the same algorithm; nothing here
 * is imported by it, and none of it is part of the public API.
 *
 * Each section below names the file it came from. Code is verbatim except where
 * a `NOTE:` marks an adaptation, all of which are mechanical:
 *
 *   - Website-only imports are inlined (`clamp`) or replaced with local types.
 *   - Code coupled to the website's React components, alphabet registry, node-canvas
 *     rasterization, filesystem output, and debug-image generation is omitted, since
 *     it is scaffolding around the algorithm rather than the algorithm.
 *
 * `@ts-nocheck` is deliberate. This library compiles under `noUncheckedIndexedAccess`,
 * which the original was not written against; suppressing that here keeps the code
 * faithful instead of sprinkling it with assertions that were never in it.
 */

// @ts-nocheck

/* -------------------------------------------------------------------------- */
/* src/math/math.ts                                                           */
/* -------------------------------------------------------------------------- */

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/* -------------------------------------------------------------------------- */
/* scripts/ascii/ascii-renderer.ts                                            */
/* -------------------------------------------------------------------------- */

export interface SamplingPoint {
  x: number; // 0-1 normalized coordinate
  y: number; // 0-1 normalized coordinate
}

export interface ExternalSamplingPoint extends SamplingPoint {
  affects: number[];
}

export interface SamplingConfig {
  points: SamplingPoint[];
  externalPoints?: ExternalSamplingPoint[];
  circleRadius: number; // radius in pixels
}

/**
 * NOTE: Adapted. The original is a private method of `AsciiRenderer` that reads
 * from a node-canvas `Canvas` via `ctx.getImageData(...)`. The pixel-walking
 * body is unchanged; it now receives the already-extracted image data so the
 * function has no canvas dependency.
 */
export function calculateCircleLightness(
  imageData: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  centerX: number,
  centerY: number,
  radius: number,
): number {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  let totalLightness = 0;
  let pixelCount = 0;

  const startX = Math.max(0, Math.floor(centerX - radius));
  const startY = Math.max(0, Math.floor(centerY - radius));
  const endX = Math.min(width, Math.ceil(centerX + radius));
  const endY = Math.min(height, Math.ceil(centerY + radius));

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      // Check if pixel is within circle
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= radius) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        totalLightness += lightness;
        pixelCount++;
      }
    }
  }

  return pixelCount > 0 ? totalLightness / pixelCount : 0;
}

export function normalizeVectorsGlobally(vectors: number[][]) {
  const K = vectors[0].length;
  const maxValues: number[] = vectors[0].map(() => 0);

  for (const vector of vectors) {
    for (let i = 0; i < K; i++) {
      maxValues[i] = Math.max(maxValues[i], vector[i]);
    }
  }

  const maxValue = Math.max(...maxValues);

  for (const vector of vectors) {
    for (let i = 0; i < K; i++) {
      vector[i] = vector[i] / maxValue;
    }
  }
}

export function createGaussianKernel(radius: number): number[] {
  const size = Math.ceil(radius * 2) * 2 + 1;
  const kernel = new Array(size);
  const sigma = radius / 3;
  const sigma2 = 2 * sigma * sigma;
  const sqrtSigmaPi2 = Math.sqrt(sigma2 * Math.PI);
  const center = Math.floor(size / 2);
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - center;
    const g = Math.exp(-(x * x) / sigma2) / sqrtSigmaPi2;
    kernel[i] = g;
    sum += g;
  }

  // Normalize kernel
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}

/* -------------------------------------------------------------------------- */
/* scripts/ascii/configs/default.ts                                           */
/* -------------------------------------------------------------------------- */

/** The tuned 6-internal / 10-external configuration for a 48x64 cell. */
export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  points: [
    { x: 0.3, y: 0.23 },
    { x: 0.7, y: 0.18 },
    { x: 0.3, y: 0.5 },
    { x: 0.7, y: 0.5 },
    { x: 0.3, y: 0.82 },
    { x: 0.7, y: 0.77 },
  ],
  externalPoints: [
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
  ],
  circleRadius: 13.5,
};

/* -------------------------------------------------------------------------- */
/* scripts/ascii/index.ts                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Build reverse mapping: internal point index → affecting external point indices
 */
export function buildAffectsMapping(
  externalPoints: Array<{ x: number; y: number; affects?: number[] }>,
  numInternalPoints: number,
): number[][] {
  const mapping: number[][] = Array.from({ length: numInternalPoints }, () => []);

  externalPoints.forEach((extPoint, extIdx) => {
    if (extPoint.affects) {
      // External point has explicit affects array
      extPoint.affects.forEach((internalIdx) => {
        if (internalIdx >= 0 && internalIdx < numInternalPoints) {
          mapping[internalIdx].push(extIdx);
        }
      });
    } else {
      // Backwards compatibility: assume 1-to-1 if no affects property
      if (extIdx < numInternalPoints) {
        mapping[extIdx].push(extIdx);
      }
    }
  });

  return mapping;
}

/* -------------------------------------------------------------------------- */
/* src/components/AsciiScene/renderConfig.ts                                  */
/* -------------------------------------------------------------------------- */

export function getSamplePoints(quality: number): { x: number; y: number }[] {
  if (quality === 1) {
    return [{ x: 0, y: 0 }]; // Circle center
  }
  if (quality === 2) {
    return [
      { x: 0.5, y: 0.3 },
      { x: -0.5, y: -0.3 },
    ];
  }
  if (quality === 3) {
    return [
      { x: 0.47, y: 0.5 },
      { x: -0.47, y: 0 },
      { x: 0.47, y: -0.5 },
    ];
  }
  if (quality === 4) {
    return [
      { x: 0.45, y: 0.45 },
      { x: 0.45, y: -0.45 },
      { x: -0.45, y: 0.45 },
      { x: -0.45, y: -0.45 },
    ];
  }

  const points: { x: number; y: number }[] = [];

  const goldenAngleRad = Math.PI * (3 - Math.sqrt(5)); // "Golden angle" in radians

  // 0.5 = uniform area, >0.5 = more center, <0.5 = more edge
  const RADIAL_DISTRIBUTION_EXPONENT = 0.5;

  for (let i = 0; i < quality; i++) {
    const theta = i * goldenAngleRad;

    const r = Math.pow((i + 0.5) / quality, RADIAL_DISTRIBUTION_EXPONENT);

    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);

    points.push({ x, y });
  }

  return points;
}

/* -------------------------------------------------------------------------- */
/* src/components/AsciiScene/sampling/cpu/generateSamplingData.ts             */
/* -------------------------------------------------------------------------- */

export function readPixelFromBuffer(pixelBuffer: Uint8Array | Uint8ClampedArray, index: number) {
  return (pixelBuffer[index] << 16) | (pixelBuffer[index + 1] << 8) | pixelBuffer[index + 2];
}

export function lightness(hexColor: number): number {
  const r = (hexColor >> 16) & 0xff;
  const g = (hexColor >> 8) & 0xff;
  const b = hexColor & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function sampleCircularRegion(
  pixelBuffer: Uint8Array | Uint8ClampedArray,
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
  samplingPoints: { x: number; y: number }[],
  flipY: boolean,
  effect: (value: number) => number,
  subsamples: number[] | undefined,
): number {
  let totalLightness = 0;
  let sampleCount = 0;

  samplingPoints.forEach((point, i) => {
    const sampleX = x + point.x;
    const sampleY = y + point.y;

    let pixelX = Math.floor(sampleX * scale);
    let pixelY = Math.floor(flipY ? canvasHeight - sampleY * scale : sampleY * scale);

    pixelX = clamp(pixelX, 0, canvasWidth - 1);
    pixelY = clamp(pixelY, 0, canvasHeight - 1);

    const index = (pixelY * canvasWidth + pixelX) * 4;

    const hexColor = readPixelFromBuffer(pixelBuffer, index);
    const lightnessValue = effect(lightness(hexColor));

    totalLightness += lightnessValue;
    sampleCount++;

    if (subsamples) {
      subsamples[i] = lightnessValue;
    }
  });

  return totalLightness / sampleCount;
}

export function crunchSamplingVector(vector: number[], exponent: number): void {
  const maxValue = Math.max(...vector);
  if (maxValue === 0) return;
  for (let i = 0; i < vector.length; i++) {
    const normalized = vector[i] / maxValue;
    const enhanced = Math.pow(normalized, exponent);
    vector[i] = enhanced * maxValue;
  }
}

export function crunchSamplingVectorDirectional(
  vector: number[],
  externalSamplingVector: number[],
  affectsMapping: number[][],
  exponent: number,
): void {
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i];

    const affectingExternalIndices = affectsMapping[i];
    let contextValue = 0;
    for (const externalIndex of affectingExternalIndices) {
      contextValue = Math.max(contextValue, externalSamplingVector[externalIndex]);
    }

    if (contextValue <= value) continue;

    const normalized = value / contextValue;
    const enhanced = Math.pow(normalized, exponent);
    vector[i] = enhanced * contextValue;
  }
}

/* -------------------------------------------------------------------------- */
/* src/components/AsciiScene/characterLookup/KdTree.ts                        */
/* -------------------------------------------------------------------------- */

interface KdTreeNode<T> {
  vector: number[];
  data: T;
  left?: KdTreeNode<T>;
  right?: KdTreeNode<T>;
  axis: number;
}

export class KdTree<T> {
  private root: KdTreeNode<T> | undefined;
  private dimensions: number;

  constructor(vectors: Array<{ vector: number[]; data: T }>) {
    if (vectors.length === 0) {
      throw new Error("Cannot create K-d tree with empty vectors array");
    }

    this.dimensions = vectors[0].vector.length;
    this.root = this.buildTree(vectors, 0);
  }

  private buildTree(
    vectors: Array<{ vector: number[]; data: T }>,
    depth: number,
  ): KdTreeNode<T> | undefined {
    if (vectors.length === 0) return undefined;
    if (vectors.length === 1) {
      return {
        vector: vectors[0].vector,
        data: vectors[0].data,
        axis: depth % this.dimensions,
      };
    }

    const axis = depth % this.dimensions;

    // Sort vectors by the current axis
    vectors.sort((a, b) => a.vector[axis] - b.vector[axis]);

    const medianIndex = Math.floor(vectors.length / 2);
    const median = vectors[medianIndex];

    return {
      vector: median.vector,
      data: median.data,
      axis,
      left: this.buildTree(vectors.slice(0, medianIndex), depth + 1),
      right: this.buildTree(vectors.slice(medianIndex + 1), depth + 1),
    };
  }

  private distance(vector1: number[], vector2: number[]): number {
    let sum = 0;
    for (let i = 0; i < this.dimensions; i++) {
      const diff = vector1[i] - vector2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  findNearest(target: number[]): { vector: number[]; data: T; distance: number } | null {
    if (!this.root) return null;

    let best: { node: KdTreeNode<T>; distance: number } = null!;

    const search = (node: KdTreeNode<T> | undefined, depth: number): void => {
      if (!node) return;

      const distance = this.distance(target, node.vector);

      if (!best || distance < best.distance) {
        best = { node, distance };
      }

      const axis = depth % this.dimensions;
      const diff = target[axis] - node.vector[axis];

      // Choose which side to search first
      const primarySide = diff < 0 ? node.left : node.right;
      const secondarySide = diff < 0 ? node.right : node.left;

      // Search the primary side
      search(primarySide, depth + 1);

      // Check if we need to search the other side
      // Only search if the distance to the splitting plane is less than our best distance
      if (!best || Math.abs(diff) < best.distance) {
        search(secondarySide, depth + 1);
      }
    };

    search(this.root, 0);

    return best
      ? {
          vector: best.node.vector,
          data: best.node.data,
          distance: best.distance,
        }
      : null;
  }
}

/* -------------------------------------------------------------------------- */
/* src/components/AsciiScene/characterLookup/CharacterMatcher.ts              */
/* -------------------------------------------------------------------------- */

/**
 * NOTE: `CharacterMatcher` itself is omitted; it loads alphabets from the
 * website's alphabet registry. Its cache-key derivation, which is the part the
 * blog post describes, is reproduced verbatim below.
 */

const BITS = 5;
const RANGE = 8;

export function quantizeToKey(vector: number[]): number {
  let key = 0;
  for (let i = 0; i < vector.length; i++) {
    const quantized = Math.min(RANGE - 1, Math.floor(vector[i] * RANGE));
    key = (key << BITS) | quantized;
  }
  return key;
}

/* -------------------------------------------------------------------------- */
/* scripts/ascii/character-selection.ts                                       */
/* -------------------------------------------------------------------------- */

/**
 * Algorithms for selecting the most distinct characters from a set of character vectors.
 * Provides both optimal and approximate solutions depending on the problem size.
 *
 * NOTE: `console.log` progress reporting has been stripped from the original;
 * the selection logic is unchanged.
 */
export class CharacterSelector {
  /**
   * Select the most distinct characters from a set of character vectors.
   * Uses optimal brute force for small sets, extremes-first algorithm for larger sets.
   */
  static selectMostDistinctCharacters(
    vectors: number[][],
    chars: string[],
    maxCount: number,
  ): { vectors: number[][]; chars: string[] } {
    if (vectors.length <= maxCount) {
      return { vectors, chars };
    }

    const n = vectors.length;

    // For small sets, use brute force optimal solution
    if (n <= 20 && maxCount <= 10) {
      return this.selectOptimalBruteForce(vectors, chars, maxCount);
    }

    // For larger sets, use extremes-first algorithm
    return this.selectUsingExtremes(vectors, chars, maxCount);
  }

  /**
   * Brute force optimal solution for small sets.
   * Finds the subset that maximizes the minimum pairwise distance.
   */
  private static selectOptimalBruteForce(
    vectors: number[][],
    chars: string[],
    maxCount: number,
  ): { vectors: number[][]; chars: string[] } {
    const n = vectors.length;
    let bestSubset: number[] = [];
    let bestMinDistance = -1;

    // Try all combinations
    const combinations = this.generateCombinations(n, maxCount);

    for (const subset of combinations) {
      let minDistance = Infinity;
      for (let i = 0; i < subset.length; i++) {
        for (let j = i + 1; j < subset.length; j++) {
          const dist = this.euclideanDistance(vectors[subset[i]], vectors[subset[j]]);
          minDistance = Math.min(minDistance, dist);
        }
      }

      if (minDistance > bestMinDistance) {
        bestMinDistance = minDistance;
        bestSubset = subset;
      }
    }

    const selectedVectors = bestSubset.map((i) => vectors[i]);
    const selectedChars = bestSubset.map((i) => chars[i]);

    return { vectors: selectedVectors, chars: selectedChars };
  }

  /**
   * Extremes-first algorithm for larger sets.
   * Prioritizes characters with extreme values to capture different visual shapes.
   */
  private static selectUsingExtremes(
    vectors: number[][],
    chars: string[],
    maxCount: number,
  ): { vectors: number[][]; chars: string[] } {
    const n = vectors.length;
    const dimensions = vectors[0].length;
    const selected: number[] = [];
    const used = new Set<number>();

    // Step 1: Find characters with extreme values in each dimension
    for (let dim = 0; dim < dimensions && selected.length < maxCount; dim++) {
      // Find minimum and maximum in this dimension
      let minIdx = -1,
        maxIdx = -1;
      let minVal = Infinity,
        maxVal = -Infinity;

      for (let i = 0; i < n; i++) {
        if (used.has(i)) continue;

        const val = vectors[i][dim];
        if (val < minVal) {
          minVal = val;
          minIdx = i;
        }
        if (val > maxVal) {
          maxVal = val;
          maxIdx = i;
        }
      }

      // Add minimum if not already selected and not too similar to existing selections
      if (minIdx !== -1 && !used.has(minIdx) && selected.length < maxCount) {
        const isSimilar = this.isSimilarToSelected(vectors, minIdx, selected, 0.3); // threshold for similarity
        if (!isSimilar || selected.length === 0) {
          selected.push(minIdx);
          used.add(minIdx);
        }
      }

      // Add maximum if different and not already selected and not too similar
      if (maxIdx !== -1 && !used.has(maxIdx) && selected.length < maxCount) {
        const isSimilar = this.isSimilarToSelected(vectors, maxIdx, selected, 0.3);
        if (!isSimilar || selected.length === 0) {
          selected.push(maxIdx);
          used.add(maxIdx);
        }
      }
    }

    // Step 2: Add characters with interesting patterns (high variance across dimensions)
    const candidates: { index: number; variance: number; range: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;

      const vector = vectors[i];
      const mean = vector.reduce((sum, val) => sum + val, 0) / vector.length;
      const variance = vector.reduce((sum, val) => sum + (val - mean) ** 2, 0) / vector.length;
      const range = Math.max(...vector) - Math.min(...vector);

      candidates.push({ index: i, variance, range });
    }

    // Sort by variance (high variance = interesting patterns)
    candidates.sort((a, b) => b.variance - a.variance);

    // Add high-variance characters that aren't too similar to existing selections
    for (const candidate of candidates) {
      if (selected.length >= maxCount) break;

      const isSimilar = this.isSimilarToSelected(vectors, candidate.index, selected, 0.4); // slightly higher threshold
      if (!isSimilar) {
        selected.push(candidate.index);
        used.add(candidate.index);
      }
    }

    // Step 3: Fill remaining slots with maximally distant characters
    while (selected.length < maxCount) {
      let bestIdx = -1;
      let maxMinDistance = -1;

      for (let i = 0; i < n; i++) {
        if (used.has(i)) continue;

        // Find minimum distance to any selected character
        let minDistance = Infinity;
        for (const selectedIdx of selected) {
          const dist = this.euclideanDistance(vectors[i], vectors[selectedIdx]);
          minDistance = Math.min(minDistance, dist);
        }

        if (minDistance > maxMinDistance) {
          maxMinDistance = minDistance;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) break; // No more candidates

      selected.push(bestIdx);
      used.add(bestIdx);
    }

    const selectedVectors = selected.map((i) => vectors[i]);
    const selectedChars = selected.map((i) => chars[i]);

    return { vectors: selectedVectors, chars: selectedChars };
  }

  /**
   * Generate all combinations of k elements from n elements.
   */
  private static generateCombinations(n: number, k: number): number[][] {
    const result: number[][] = [];

    function backtrack(start: number, current: number[]) {
      if (current.length === k) {
        result.push([...current]);
        return;
      }

      for (let i = start; i <= n - (k - current.length); i++) {
        current.push(i);
        backtrack(i + 1, current);
        current.pop();
      }
    }

    backtrack(0, []);
    return result;
  }

  /**
   * Check if a candidate character is too similar to already selected characters.
   */
  private static isSimilarToSelected(
    vectors: number[][],
    candidateIdx: number,
    selectedIndices: number[],
    threshold: number,
  ): boolean {
    if (selectedIndices.length === 0) return false;

    const candidateVector = vectors[candidateIdx];

    for (const selectedIdx of selectedIndices) {
      const selectedVector = vectors[selectedIdx];
      const distance = this.euclideanDistance(candidateVector, selectedVector);

      if (distance < threshold) {
        return true; // Too similar
      }
    }

    return false; // Not similar to any selected character
  }

  /**
   * Calculate Euclidean distance between two vectors.
   */
  private static euclideanDistance(v1: number[], v2: number[]): number {
    return Math.sqrt(v1.reduce((sum, val, i) => sum + (val - v2[i]) ** 2, 0));
  }
}
