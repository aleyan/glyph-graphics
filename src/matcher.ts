import { KdTree } from "./kdtree.js";
import type { Alphabet } from "./types.js";

export interface MatcherOptions {
  /**
   * Memoize lookups by quantizing the sampling vector. Neighbouring cells and
   * successive frames produce near-identical vectors, so the cache absorbs most
   * lookups after the first frame.
   */
  cache?: boolean;
  /** Characters to drop from the alphabet, e.g. `"@#"` to avoid heavy glyphs. */
  exclude?: string;
}

/** Maps a sampling vector to the character whose shape vector is nearest it. */
export class CharacterMatcher {
  private readonly tree: KdTree;
  private readonly chars: string[];
  private readonly dimensions: number;
  private readonly cache: Map<number, string> | null;
  private readonly quantizeBits: number;
  private readonly quantizeLevels: number;

  constructor(alphabet: Alphabet, options: MatcherOptions = {}) {
    const { cache = true, exclude = "" } = options;
    this.dimensions = alphabet.dimensions;

    const kept: number[] = [];
    alphabet.chars.forEach((char, i) => {
      if (!exclude.includes(char)) kept.push(i);
    });
    if (kept.length === 0) throw new Error("Every character was excluded from the alphabet");

    this.chars = kept.map((i) => alphabet.chars[i] ?? " ");
    const vectors = new Float32Array(kept.length * this.dimensions);
    kept.forEach((source, target) => {
      vectors.set(
        alphabet.vectors.subarray(source * this.dimensions, (source + 1) * this.dimensions),
        target * this.dimensions,
      );
    });

    this.tree = new KdTree(vectors, this.dimensions);
    this.cache = cache ? new Map() : null;

    // Keys must stay within the 31 bits that bitwise ops give us, so high
    // dimension counts trade cache precision for a usable key.
    this.quantizeBits = Math.max(1, Math.min(5, Math.floor(31 / this.dimensions)));
    this.quantizeLevels = 1 << this.quantizeBits;
  }

  /** The characters this matcher can return, in shape-vector order. */
  get characters(): readonly string[] {
    return this.chars;
  }

  /**
   * Returns the closest glyph for one sampling vector.
   *
   * The vector must use the same dimensions and layout as the alphabet passed
   * to the constructor.
   */
  match(vector: ArrayLike<number>): string {
    if (!this.cache) return this.lookup(vector);

    const key = this.quantize(vector);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const result = this.lookup(vector);
    this.cache.set(key, result);
    return result;
  }

  private lookup(vector: ArrayLike<number>): string {
    const { index } = this.tree.findNearest(vector);
    return this.chars[index] ?? " ";
  }

  private quantize(vector: ArrayLike<number>): number {
    let key = 0;
    for (let i = 0; i < this.dimensions; i++) {
      const value = vector[i] ?? 0;
      const level = Math.min(this.quantizeLevels - 1, Math.max(0, Math.floor(value * this.quantizeLevels)));
      key = (key << this.quantizeBits) | level;
    }
    return key;
  }
}
