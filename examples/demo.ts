/**
 * Terminal showcase, run with `bun run demo`.
 *
 * Everything here is generated procedurally and converted through the real
 * pipeline against a real system font — no fixtures, no pre-baked output.
 */
import { createCanvas } from "@napi-rs/canvas";
import {
  alexHarriAlgorithm,
  buildAlexHarriAlphabet,
  charsets,
  toText,
  type AlexHarriOptions,
} from "../src/index";
import type { CanvasFactory, CanvasLike } from "../src/raster";
import type { Alphabet, AsciiFrame, Frame } from "../src/types";

// @napi-rs/canvas satisfies the shape structurally; the cast bridges its own
// nominal types rather than papering over a real mismatch.
const canvas: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as CanvasLike;

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function heading(title: string, note?: string): void {
  console.log(`\n${BOLD}${title}${RESET}${note ? ` ${DIM}${note}${RESET}` : ""}\n`);
}

/* -------------------------------------------------------------------------- */
/* Scenes                                                                     */
/* -------------------------------------------------------------------------- */

function makeScene(
  width: number,
  height: number,
  shade: (x: number, y: number) => number,
): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = Math.max(0, Math.min(255, shade(x, y)));
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** A sphere lit from the upper left: smooth tone, curved terminator. */
function sphere(size = 512): Frame {
  const radius = size * 0.42;
  const c = size / 2;
  const [lx, ly, lz] = [-0.5, -0.6, 0.62];

  return makeScene(size, size, (x, y) => {
    const nx = (x - c) / radius;
    const ny = (y - c) / radius;
    const r2 = nx * nx + ny * ny;
    if (r2 > 1) return 0;
    const nz = Math.sqrt(1 - r2);
    return 20 + 235 * Math.pow(Math.max(0, nx * lx + ny * ly + nz * lz), 0.9);
  });
}

/** Hard-edged geometry: the case where a density ramp turns to mush. */
function glyphTest(size = 512): Frame {
  return makeScene(size, size, (x, y) => {
    const u = x / size;
    const v = y / size;

    // A diagonal band, a disc, and a rectangle — straight edges at several angles.
    const diagonal = Math.abs(u - v) < 0.09;
    const disc = Math.hypot(u - 0.72, v - 0.28) < 0.17;
    const bar = u > 0.14 && u < 0.34 && v > 0.62 && v < 0.86;
    const wedge = u + v > 1.42 && v > 0.6;

    return diagonal || disc || bar || wedge ? 255 : 0;
  });
}

/* -------------------------------------------------------------------------- */
/* Layout helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Prints labelled text blocks in columns, padded to a common height. */
function columns(blocks: { label: string; text: string }[], gutter = 4): void {
  const grids = blocks.map((b) => b.text.split("\n"));
  const widths = grids.map((rows) => Math.max(...rows.map((r) => r.length)));
  const height = Math.max(...grids.map((rows) => rows.length));
  const pad = " ".repeat(gutter);

  const labels = blocks
    .map((b, i) => `${DIM}${b.label.padEnd(widths[i]!)}${RESET}`)
    .join(pad);
  console.log(labels);

  for (let row = 0; row < height; row++) {
    console.log(grids.map((rows, i) => (rows[row] ?? "").padEnd(widths[i]!)).join(pad));
  }
}

/** Renders a character's shape vector as a small intensity grid. */
function vectorArt(alphabet: Alphabet, char: string): string[] {
  const ramp = " ░▒▓█";
  const { cols, rows } = alphabet.layout.zones;
  const index = alphabet.chars.indexOf(char);
  const base = index * alphabet.dimensions;

  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const value = alphabet.vectors[base + row * cols + col] ?? 0;
      return ramp[Math.min(ramp.length - 1, Math.floor(value * ramp.length))]!.repeat(2);
    }).join(""),
  );
}

/* -------------------------------------------------------------------------- */
/* Demo                                                                       */
/* -------------------------------------------------------------------------- */

const FONT = { family: "Menlo, DejaVu Sans Mono, monospace", size: 64 };
const ZONES = { cols: 2, rows: 3 };

function alphabetFor(chars: string): Alphabet {
  return buildAlexHarriAlphabet({ font: FONT, chars, canvas });
}

function convert(frame: Frame, alphabet: Alphabet, options: AlexHarriOptions): AsciiFrame {
  return alexHarriAlgorithm.convert(frame, alphabet, options);
}

const ascii = alphabetFor(charsets.SHAPE_ASCII);

console.log(
  `\n${BOLD}glyph-graphics${RESET} ${DIM}— ${ascii.chars.length} characters, ` +
    `${ZONES.cols}x${ZONES.rows} zones, ${ascii.dimensions}-D shape vectors, ` +
    `${FONT.family.split(",")[0]}${RESET}`,
);

heading("A lit sphere", "smooth tone; the ramp below is discovered, not hand-ordered");
console.log(
  toText(convert(sphere(), ascii, { cols: 74, quality: 7, globalCrunch: 2 })),
);

heading("The same scene across character sets");
const scene = sphere(384);
columns([
  { label: "SHAPE_ASCII", text: toText(convert(scene, ascii, { cols: 34, quality: 7 })) },
  {
    label: "RAMP",
    text: toText(convert(scene, alphabetFor(charsets.RAMP), { cols: 34, quality: 7 })),
  },
]);

heading("Hard edges", "directional crunch sharpens boundaries that cross cell seams");
const edges = glyphTest();
columns([
  {
    label: "plain",
    text: toText(convert(edges, ascii, { cols: 34, quality: 7 })),
  },
  {
    label: "directionalCrunch: 3",
    text: toText(convert(edges, ascii, { cols: 34, quality: 7, directionalCrunch: 3 })),
  },
]);

heading("Why shape beats a density ramp", "measured ink per zone, for glyphs a ramp cannot tell apart");
for (const pair of [
  ["p", "q"],
  ["b", "d"],
  ["/", "\\"],
  ["'", ","],
]) {
  const art = pair.map((char) => ({ char, rows: vectorArt(ascii, char) }));
  const height = art[0]!.rows.length;
  const header = art.map(({ char }) => `${DIM}${char.padEnd(4)}${RESET}`).join("   ");
  console.log(`  ${header}`);
  for (let row = 0; row < height; row++) {
    console.log(`  ${art.map(({ rows }) => rows[row]!.padEnd(4)).join("   ")}`);
  }
  console.log();
}

heading("Colour", "an average RGB per cell, for tinting a tilemap renderer");
const tinted = convert(sphere(256), ascii, { cols: 24, quality: 7, color: true });
console.log(`  ${DIM}chars: ${tinted.cols}x${tinted.rows}${RESET}`);
console.log(`  ${DIM}colors: ${tinted.colors?.length} bytes (${tinted.cols * tinted.rows} RGB triplets)${RESET}\n`);
