/**
 * Three.js tilemap renderer. Imported from the `glyph-graphics/three` subpath so
 * `three` stays an optional peer dependency: consumers who never import this
 * module never pull in three, and it is absent from the default bundle.
 */
export { AsciiTilemap } from "./renderer.js";
export type { AsciiTilemapOptions } from "./renderer.js";

export { buildGlyphAtlas, packColors, packGlyphIndices } from "./atlas.js";
export type { AtlasOptions, GlyphAtlas } from "./atlas.js";

export { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders.js";
