/**
 * ASCII video codec and playback. Imported from the `glyph-graphics/video`
 * subpath.
 */
export {
  ASCII_VIDEO_FORMAT,
  ASCII_VIDEO_VERSION,
  MAX_PALETTE_COLORS,
  buildAsciiVideoPalette,
  createAsciiVideoCursor,
  encodeAsciiVideo,
  expandPaletteColors,
  paletteCodeWidth,
  parseAsciiVideo,
} from "./codec.js";
export type {
  AsciiVideo,
  AsciiVideoCursor,
  AsciiVideoEncodeOptions,
  AsciiVideoEncoding,
  AsciiVideoRun,
  AsciiVideoSourceFrame,
  PaletteCodeWidth,
} from "./codec.js";

export {
  TERMINAL_ALT_SCREEN_ENTER,
  TERMINAL_ALT_SCREEN_LEAVE,
  TERMINAL_CURSOR_HIDE,
  TERMINAL_CURSOR_SHOW,
  asciiVideoClosing,
  asciiVideoOpening,
  createAsciiVideoPainter,
  playAsciiVideo,
} from "./terminal.js";
export type {
  AsciiVideoPainter,
  AsciiVideoPlayback,
  AsciiVideoPlaybackOptions,
  Point,
  Rgb,
  TimerHost,
} from "./terminal.js";

