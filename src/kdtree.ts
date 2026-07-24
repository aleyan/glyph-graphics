interface Node {
  /** Index of this node's vector in the flat vector store. */
  index: number;
  left: Node | null;
  right: Node | null;
}

export interface NearestResult {
  index: number;
  /** Squared Euclidean distance. Squaring is monotonic, so ordering is preserved. */
  distanceSquared: number;
}

/**
 * Exact nearest-neighbour search over vectors held in one flat array.
 *
 * A linear scan is fine for a single lookup, but conversion performs one lookup
 * per cell per frame, where the tree's pruning is the difference between a
 * smooth animation and a slideshow.
 */
export class KdTree {
  private readonly root: Node | null;

  constructor(
    private readonly vectors: Float32Array,
    private readonly dimensions: number,
  ) {
    if (dimensions < 1) throw new Error(`dimensions must be at least 1, got ${dimensions}`);
    const count = Math.floor(vectors.length / dimensions);
    if (count === 0) throw new Error("Cannot build a k-d tree from zero vectors");
    this.root = this.build(
      Array.from({ length: count }, (_, i) => i),
      0,
    );
  }

  private at(index: number, axis: number): number {
    return this.vectors[index * this.dimensions + axis] ?? 0;
  }

  private build(indices: number[], depth: number): Node | null {
    if (indices.length === 0) return null;

    const axis = depth % this.dimensions;
    indices.sort((a, b) => this.at(a, axis) - this.at(b, axis));

    const mid = indices.length >> 1;
    const index = indices[mid];
    if (index === undefined) return null;

    return {
      index,
      left: this.build(indices.slice(0, mid), depth + 1),
      right: this.build(indices.slice(mid + 1), depth + 1),
    };
  }

  private distanceSquared(target: ArrayLike<number>, index: number): number {
    let sum = 0;
    const base = index * this.dimensions;
    for (let i = 0; i < this.dimensions; i++) {
      const diff = (target[i] ?? 0) - (this.vectors[base + i] ?? 0);
      sum += diff * diff;
    }
    return sum;
  }

  /**
   * Finds the stored vector nearest to `target`.
   *
   * `index` addresses the original flat vector store and `distanceSquared` is
   * its squared Euclidean distance from the target.
   */
  findNearest(target: ArrayLike<number>): NearestResult {
    let bestIndex = -1;
    let bestDistance = Infinity;

    const search = (node: Node | null, depth: number): void => {
      if (!node) return;

      const distance = this.distanceSquared(target, node.index);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = node.index;
      }

      const axis = depth % this.dimensions;
      const delta = (target[axis] ?? 0) - this.at(node.index, axis);
      const [near, far] = delta < 0 ? [node.left, node.right] : [node.right, node.left];

      search(near, depth + 1);
      // The far subtree can only hold something closer if the splitting plane
      // itself is closer than the best match found so far.
      if (delta * delta < bestDistance) search(far, depth + 1);
    };

    search(this.root, 0);
    return { index: bestIndex, distanceSquared: bestDistance };
  }
}
