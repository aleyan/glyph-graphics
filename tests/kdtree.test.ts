import { describe, expect, test } from "bun:test";
import { KdTree } from "../src/kdtree";

function bruteForce(vectors: Float32Array, dimensions: number, target: number[]): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < vectors.length / dimensions; i++) {
    let sum = 0;
    for (let d = 0; d < dimensions; d++) {
      const diff = target[d]! - vectors[i * dimensions + d]!;
      sum += diff * diff;
    }
    if (sum < bestDistance) {
      bestDistance = sum;
      best = i;
    }
  }
  return best;
}

/** Deterministic pseudo-random source, so a failure is always reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("KdTree", () => {
  test("agrees with brute force across dimensions and sizes", () => {
    for (const dimensions of [1, 2, 4, 6, 9]) {
      for (const count of [1, 2, 17, 200]) {
        const random = makeRandom(dimensions * 1000 + count);
        const vectors = new Float32Array(count * dimensions);
        for (let i = 0; i < vectors.length; i++) vectors[i] = random();

        const tree = new KdTree(vectors, dimensions);
        for (let trial = 0; trial < 25; trial++) {
          const target = Array.from({ length: dimensions }, () => random());
          const expected = bruteForce(vectors, dimensions, target);
          const actual = tree.findNearest(target);

          // Ties are legal, so compare distance rather than index.
          let expectedDistance = 0;
          for (let d = 0; d < dimensions; d++) {
            const diff = target[d]! - vectors[expected * dimensions + d]!;
            expectedDistance += diff * diff;
          }
          expect(actual.distanceSquared).toBeCloseTo(expectedDistance, 6);
        }
      }
    }
  });

  test("returns an exact hit for a vector already in the tree", () => {
    const vectors = new Float32Array([0, 0, 1, 1, 0.5, 0.25]);
    const tree = new KdTree(vectors, 2);

    const result = tree.findNearest([0.5, 0.25]);
    expect(result.index).toBe(2);
    expect(result.distanceSquared).toBeCloseTo(0, 10);
  });

  test("rejects empty and malformed inputs", () => {
    expect(() => new KdTree(new Float32Array(0), 3)).toThrow();
    expect(() => new KdTree(new Float32Array([1, 2]), 0)).toThrow();
  });
});
