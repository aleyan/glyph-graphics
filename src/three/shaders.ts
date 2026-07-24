/**
 * Tilemap shaders. One quad covers the whole grid; the fragment shader reads a
 * glyph index per cell, then samples that glyph from the atlas. This keeps the
 * draw at a single quad regardless of grid size, which is what lets a full-frame
 * conversion animate.
 *
 * Everything works in a y-down, top-left coordinate frame so the atlas (drawn by
 * canvas), the index texture, and the colour texture all agree without flips.
 * The textures are therefore uploaded with `flipY = false`.
 */

export const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uAtlas;
  uniform sampler2D uGlyphIndex;
  uniform sampler2D uColor;
  uniform vec2 uGridSize;    // cells: cols, rows
  uniform vec2 uAtlasGrid;   // tiles: cols, rows
  uniform vec3 uBackground;
  uniform vec3 uInk;
  uniform float uUseColor;   // 1 to tint by the colour texture, 0 for flat ink

  varying vec2 vUv;

  void main() {
    // Screen space with a top-left origin, so grid row 0 is the top row.
    vec2 screen = vec2(vUv.x, 1.0 - vUv.y);

    vec2 gridPos = screen * uGridSize;
    vec2 cell = floor(gridPos);
    vec2 within = gridPos - cell;                 // position inside the cell
    vec2 cellUv = (cell + 0.5) / uGridSize;       // sample cell textures at centre

    // Decode the glyph index from the low and high bytes.
    vec4 packed = texture2D(uGlyphIndex, cellUv);
    float index = floor(packed.r * 255.0 + 0.5) + floor(packed.g * 255.0 + 0.5) * 256.0;

    // Locate the glyph's tile in the atlas and sample within it.
    float tileCol = mod(index, uAtlasGrid.x);
    float tileRow = floor(index / uAtlasGrid.x);
    vec2 atlasUv = (vec2(tileCol, tileRow) + within) / uAtlasGrid;
    float ink = texture2D(uAtlas, atlasUv).r;

    vec3 tint = mix(uInk, texture2D(uColor, cellUv).rgb, uUseColor);
    gl_FragColor = vec4(mix(uBackground, tint, ink), 1.0);
  }
`;
