import type { Alphabet } from "./types.js";

/**
 * Reduces an alphabet to `count` characters that stay as far apart as possible
 * in shape space.
 *
 * Uses greedy farthest-point sampling: repeatedly take the character furthest
 * from everything already chosen. A large character set is mostly redundant —
 * dozens of glyphs cluster around "medium grey blob" — and thinning it both
 * speeds up matching and stops near-ties from flickering between frames.
 */
export function selectMostDistinct(alphabet: Alphabet, count: number): Alphabet {
  const { chars, vectors, dimensions } = alphabet;
  if (count >= chars.length) return alphabet;
  if (count < 1) throw new Error(`count must be at least 1, got ${count}`);

  const total = chars.length;
  const distanceSquared = (a: number, b: number): number => {
    let sum = 0;
    for (let i = 0; i < dimensions; i++) {
      const diff = (vectors[a * dimensions + i] ?? 0) - (vectors[b * dimensions + i] ?? 0);
      sum += diff * diff;
    }
    return sum;
  };
  const magnitude = (index: number): number => {
    let sum = 0;
    for (let i = 0; i < dimensions; i++) sum += vectors[index * dimensions + i] ?? 0;
    return sum;
  };

  // Seed with the emptiest glyph. The darkest and brightest ends of the range
  // matter most visually, and starting at one end makes the result stable
  // rather than dependent on character order.
  let seed = 0;
  let seedMagnitude = Infinity;
  for (let i = 0; i < total; i++) {
    const value = magnitude(i);
    if (value < seedMagnitude) {
      seedMagnitude = value;
      seed = i;
    }
  }

  const selected = [seed];
  const nearest = new Float32Array(total);
  for (let i = 0; i < total; i++) nearest[i] = distanceSquared(i, seed);

  while (selected.length < count) {
    let best = -1;
    let bestDistance = -1;
    for (let i = 0; i < total; i++) {
      const distance = nearest[i] ?? 0;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best < 0 || bestDistance <= 0) break;

    selected.push(best);
    for (let i = 0; i < total; i++) {
      nearest[i] = Math.min(nearest[i] ?? 0, distanceSquared(i, best));
    }
  }

  // Preserve the original ordering so serialized alphabets stay readable.
  selected.sort((a, b) => a - b);

  const picked = new Float32Array(selected.length * dimensions);
  selected.forEach((source, target) => {
    picked.set(
      vectors.subarray(source * dimensions, (source + 1) * dimensions),
      target * dimensions,
    );
  });

  return {
    ...alphabet,
    chars: selected.map((i) => chars[i] ?? " "),
    vectors: picked,
  };
}
