import type {
  CellSize,
  ExternalSamplePoint,
  SamplePoint,
  SamplingLayout,
  ZoneGrid,
} from "./types.js";

export interface LayoutOptions {
  /** How many sampling zones the cell is divided into, e.g. `{ cols: 2, rows: 3 }`. */
  zones: ZoneGrid;
  /** Cell dimensions in pixels. Only the aspect ratio affects the layout. */
  cell: CellSize;
  /**
   * Pulls internal circles toward the cell centre, as a fraction of their
   * distance from it. Glyph ink concentrates near the centre of a cell, so a
   * small inset samples more ink and less padding.
   */
  inset?: number;
  /**
   * Circle radius as a fraction of half the smaller zone dimension. At 1 the
   * circles just touch; above 1 they overlap and blur zone boundaries.
   */
  radiusScale?: number;
  /** Whether to generate external circles for directional contrast. */
  external?: boolean;
  /** Insets the outermost external circles from the cell corners. */
  edgeInset?: number;
  /**
   * How far an external circle's influence reaches, in zone widths. The default
   * lets a circle affect its own zone and roughly one zone past it.
   */
  affectSpread?: number;
}

const DEFAULTS = {
  inset: 0.08,
  radiusScale: 0.93,
  external: true,
  edgeInset: 0.07,
  affectSpread: 1.5,
} as const;

/** Zone centres along one axis, pulled toward 0.5 by `inset`. */
function zoneCenters(n: number, inset: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return 0.5 + (t - 0.5) * (1 - inset);
  });
}

/** `n` positions spread evenly across `[edgeInset, 1 - edgeInset]`. */
function edgeSpread(n: number, edgeInset: number): number[] {
  if (n === 1) return [0.5];
  const hi = 1 - edgeInset;
  return Array.from({ length: n }, (_, i) => edgeInset + (hi - edgeInset) * (i / (n - 1)));
}

/**
 * Builds the sampling geometry for a zone grid.
 *
 * Internal circles sit at zone centres and become the dimensions of every shape
 * vector. External circles ring the cell just outside its edges; they let a
 * bright neighbouring cell pull contrast across the boundary, which is what
 * keeps edges in the source image reading as edges in the output.
 */
export function buildLayout(options: LayoutOptions): SamplingLayout {
  const { zones, cell } = options;
  const inset = options.inset ?? DEFAULTS.inset;
  const radiusScale = options.radiusScale ?? DEFAULTS.radiusScale;
  const external = options.external ?? DEFAULTS.external;
  const edgeInset = options.edgeInset ?? DEFAULTS.edgeInset;
  const affectSpread = options.affectSpread ?? DEFAULTS.affectSpread;

  if (zones.cols < 1 || zones.rows < 1) {
    throw new Error(`zones must be at least 1x1, got ${zones.cols}x${zones.rows}`);
  }
  if (cell.width <= 0 || cell.height <= 0) {
    throw new Error(`cell must have positive dimensions, got ${cell.width}x${cell.height}`);
  }

  // Circles are round in pixel space, so the radius is derived in pixels from
  // the smaller zone dimension and then normalized to cell width.
  const zoneWidth = cell.width / zones.cols;
  const zoneHeight = cell.height / zones.rows;
  const radiusPx = 0.5 * Math.min(zoneWidth, zoneHeight) * radiusScale;
  const radius = radiusPx / cell.width;

  const xs = zoneCenters(zones.cols, inset);
  const ys = zoneCenters(zones.rows, inset);

  const points: SamplePoint[] = [];
  for (const y of ys) {
    for (const x of xs) {
      points.push({ x, y });
    }
  }

  const externalPoints = external
    ? buildExternalPoints(points, zones, cell, radiusPx, edgeInset, affectSpread)
    : [];

  const affectedBy: number[][] = points.map(() => []);
  externalPoints.forEach((point, externalIndex) => {
    for (const internalIndex of point.affects) {
      affectedBy[internalIndex]?.push(externalIndex);
    }
  });

  return { zones, points, external: externalPoints, affectedBy, radius };
}

function buildExternalPoints(
  points: SamplePoint[],
  zones: ZoneGrid,
  cell: CellSize,
  radiusPx: number,
  edgeInset: number,
  affectSpread: number,
): ExternalSamplePoint[] {
  // Sit one radius clear of the cell so external circles read the neighbour
  // rather than re-reading this cell's own ink.
  const offsetX = radiusPx / cell.width;
  const offsetY = radiusPx / cell.height;

  const xSpread = edgeSpread(zones.cols, edgeInset);
  const ySpread = edgeSpread(zones.rows, edgeInset);

  const xReach = affectSpread / zones.cols;
  const yReach = affectSpread / zones.rows;

  const index = (col: number, row: number) => row * zones.cols + col;
  const lastCol = zones.cols - 1;
  const lastRow = zones.rows - 1;

  const result: ExternalSamplePoint[] = [];

  // Horizontal edges reach into the nearest row; vertical edges into the
  // nearest column. Reach is measured along the edge, so a circle at a corner
  // affects fewer internal points than one at the middle of an edge.
  for (const x of xSpread) {
    const near = (row: number) =>
      Array.from({ length: zones.cols }, (_, col) => index(col, row)).filter(
        (i) => Math.abs((points[i]?.x ?? 0) - x) <= xReach,
      );
    result.push({ x, y: -offsetY, affects: near(0) });
  }
  for (const y of ySpread) {
    const near = (col: number) =>
      Array.from({ length: zones.rows }, (_, row) => index(col, row)).filter(
        (i) => Math.abs((points[i]?.y ?? 0) - y) <= yReach,
      );
    result.push({ x: -offsetX, y, affects: near(0) });
    result.push({ x: 1 + offsetX, y, affects: near(lastCol) });
  }
  for (const x of xSpread) {
    const near = (row: number) =>
      Array.from({ length: zones.cols }, (_, col) => index(col, row)).filter(
        (i) => Math.abs((points[i]?.x ?? 0) - x) <= xReach,
      );
    result.push({ x, y: 1 + offsetY, affects: near(lastRow) });
  }

  return result;
}

/**
 * Sample offsets within a unit disk, used to estimate a circle's average
 * lightness from `count` taps.
 *
 * The low counts are hand-placed because a golden-angle spiral wastes its first
 * few points near the centre, where they say the least about the circle.
 */
export function unitDiskSamples(count: number): SamplePoint[] {
  if (count < 1) throw new Error(`sampling quality must be at least 1, got ${count}`);
  if (count === 1) return [{ x: 0, y: 0 }];
  if (count === 2) {
    return [
      { x: 0.5, y: 0.3 },
      { x: -0.5, y: -0.3 },
    ];
  }
  if (count === 3) {
    return [
      { x: 0.47, y: 0.5 },
      { x: -0.47, y: 0 },
      { x: 0.47, y: -0.5 },
    ];
  }
  if (count === 4) {
    return [
      { x: 0.45, y: 0.45 },
      { x: 0.45, y: -0.45 },
      { x: -0.45, y: 0.45 },
      { x: -0.45, y: -0.45 },
    ];
  }

  // Vogel spiral. The 0.5 exponent spreads points by equal area, so every part
  // of the disk contributes equally to the average.
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const theta = i * goldenAngle;
    const r = Math.sqrt((i + 0.5) / count);
    return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
  });
}
