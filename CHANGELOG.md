# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- The README now focuses on the primary alphabet construction and conversion
  workflow while retaining the configurable APIs used by advanced consumers.
- The optional `glyph-graphics/three` entrypoint now exposes `AsciiTilemap`
  rather than its internal atlas packers and shaders.
- The optional `glyph-graphics/video` entrypoint provides palette-quantized,
  delta-encoded JSONL for prerendered ASCII video plus browser and terminal
  playback helpers. It is independent of Three.js and the core entrypoint.
- `packGlyphIndices` and `packColors` accept an optional buffer to write into,
  and `AsciiTilemap.update` passes its own texture buffers. Uploading a frame no
  longer allocates two textures' worth of scratch, which at video frame rates was
  the only garbage the upload path produced. Both functions still return a fresh
  buffer when none is given, or when the one given is the wrong size.

## [0.1.0] - 2026-07-23

### Added

- Shape-aware image-to-ASCII conversion using Alex Harri Jónsson's published
  six-zone sampling geometry.
- Browser and injectable server-canvas alphabet measurement.
- JSON-safe alphabet serialization.
- Optional `glyph-graphics/three` tilemap renderer.
- ESM, CommonJS, and TypeScript declaration exports.

[Unreleased]: https://github.com/aleyan/glyph-graphics/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aleyan/glyph-graphics/releases/tag/v0.1.0
