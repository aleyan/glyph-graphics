/**
 * Three.js tilemap renderer. Imported from the `glyph-graphics/three` subpath so
 * `three` stays an optional peer dependency: consumers who never import this
 * module never pull in three, and it is absent from the default bundle.
 */
export { AsciiTilemap } from "./renderer";
export type { AsciiTilemapOptions } from "./renderer";

export { buildGlyphAtlas, packColors, packGlyphIndices } from "./atlas";
export type { AtlasOptions, GlyphAtlas } from "./atlas";

export { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";
