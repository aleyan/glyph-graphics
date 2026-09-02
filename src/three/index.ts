/**
 * Optional Three.js renderer. Importing the core `glyph-graphics` entrypoint
 * never loads Three.js; this adapter is available only from `glyph-graphics/three`.
 */
export { AsciiTilemap } from "./renderer.js";
export type { AsciiTilemapOptions } from "./renderer.js";

export { buildGlyphAtlas, packColors, packGlyphIndices } from "./atlas.js";
export type { AtlasOptions, GlyphAtlas } from "./atlas.js";

export { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders.js";

