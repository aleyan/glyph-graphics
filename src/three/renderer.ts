import * as THREE from "three";
import {
  buildGlyphAtlas,
  packColors,
  packGlyphIndices,
  type AtlasOptions,
  type GlyphAtlas,
} from "./atlas.js";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders.js";
import type { Alphabet, AsciiFrame } from "../types.js";

function parseColor(color: THREE.ColorRepresentation): THREE.Vector3 {
  const c = new THREE.Color(color);
  return new THREE.Vector3(c.r, c.g, c.b);
}

export interface AsciiTilemapOptions extends AtlasOptions {
  /** Paper colour behind the glyphs. Default black. */
  background?: THREE.ColorRepresentation;
  /** Ink colour, used for cells the frame gives no colour of its own. Default white. */
  ink?: THREE.ColorRepresentation;
  /** Tint each glyph by the frame's per-cell colour, when present. Default true. */
  useColor?: boolean;
  /** Prebuilt atlas, to share one across several tilemaps. Built from the alphabet otherwise. */
  atlas?: GlyphAtlas;
}

/**
 * Renders converted frames as a glyph tilemap on a single textured quad.
 *
 * The mesh spans one unit, centred on the origin, and preserves the alphabet's
 * cell aspect ratio so glyphs are never stretched. Add `mesh` to a scene and
 * call `update` with each converted frame; the glyph atlas is built once and
 * only per-cell data changes between frames.
 */
export class AsciiTilemap {
  readonly mesh: THREE.Mesh;
  readonly atlas: GlyphAtlas;

  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly atlasTexture: THREE.DataTexture;
  private glyphTexture: THREE.DataTexture | null = null;
  private colorTexture: THREE.DataTexture | null = null;
  private glyphData: Uint8Array = new Uint8Array(0);
  private colorData: Uint8Array = new Uint8Array(0);
  private cols = 0;
  private rows = 0;

  constructor(alphabet: Alphabet, options: AsciiTilemapOptions = {}) {
    this.atlas = options.atlas ?? buildGlyphAtlas(alphabet, options);

    this.atlasTexture = makeDataTexture(
      expandCoverage(this.atlas.coverage),
      this.atlas.width,
      this.atlas.height,
    );
    // Bilinear so glyph edges stay smooth when the quad is larger than the atlas.
    this.atlasTexture.magFilter = THREE.LinearFilter;
    this.atlasTexture.minFilter = THREE.LinearFilter;
    this.atlasTexture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: this.atlasTexture },
        uGlyphIndex: { value: null },
        uColor: { value: null },
        uGridSize: { value: new THREE.Vector2(1, 1) },
        uAtlasGrid: { value: new THREE.Vector2(this.atlas.cols, this.atlas.rows) },
        uBackground: { value: parseColor(options.background ?? 0x000000) },
        uInk: { value: parseColor(options.ink ?? 0xffffff) },
        uUseColor: { value: options.useColor === false ? 0 : 1 },
      },
    });

    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
  }

  /** The mesh's aspect ratio (width / height), set on the last `update`. */
  get aspect(): number {
    if (this.rows === 0) return 1;
    return (this.cols * this.atlas.tileWidth) / (this.rows * this.atlas.tileHeight);
  }

  /** Uploads a converted frame. Reallocates textures only when the grid resizes. */
  update(frame: AsciiFrame): void {
    if (frame.cols !== this.cols || frame.rows !== this.rows) {
      this.resize(frame.cols, frame.rows);
    }

    this.glyphData.set(packGlyphIndices(frame, this.atlas));
    this.glyphTexture!.needsUpdate = true;

    this.colorData.set(packColors(frame));
    this.colorTexture!.needsUpdate = true;

    // Keep the quad at the frame's aspect so glyphs render square-on.
    this.mesh.scale.set(this.aspect, 1, 1);
  }

  private resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;

    this.glyphTexture?.dispose();
    this.colorTexture?.dispose();

    this.glyphData = new Uint8Array(cols * rows * 4);
    this.colorData = new Uint8Array(cols * rows * 4);
    this.glyphTexture = makeDataTexture(this.glyphData, cols, rows);
    this.colorTexture = makeDataTexture(this.colorData, cols, rows);

    this.material.uniforms.uGlyphIndex!.value = this.glyphTexture;
    this.material.uniforms.uColor!.value = this.colorTexture;
    (this.material.uniforms.uGridSize!.value as THREE.Vector2).set(cols, rows);
  }

  /** Changes the paper color without rebuilding the tilemap. */
  setBackground(color: THREE.ColorRepresentation): void {
    (this.material.uniforms.uBackground!.value as THREE.Vector3).copy(parseColor(color));
  }

  /** Changes the fallback ink color used when per-cell color is unavailable or disabled. */
  setInk(color: THREE.ColorRepresentation): void {
    (this.material.uniforms.uInk!.value as THREE.Vector3).copy(parseColor(color));
  }

  /** Enables or disables tinting glyphs with the frame's per-cell colors. */
  setUseColor(useColor: boolean): void {
    this.material.uniforms.uUseColor!.value = useColor ? 1 : 0;
  }

  /** Releases every GPU resource this tilemap owns. */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.atlasTexture.dispose();
    this.glyphTexture?.dispose();
    this.colorTexture?.dispose();
  }
}

/** Nearest-filtered RGBA data texture, y-down top-left (no flip). */
function makeDataTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Widens single-channel coverage into the RGBA a DataTexture expects. */
function expandCoverage(coverage: Uint8Array): Uint8Array {
  const data = new Uint8Array(coverage.length * 4);
  for (let i = 0; i < coverage.length; i++) {
    const value = coverage[i] ?? 0;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return data;
}
