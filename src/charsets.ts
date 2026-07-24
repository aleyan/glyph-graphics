/** The 94 printable ASCII characters, plus space. */
export const ASCII =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

/**
 * Punctuation and symbols only. Letters carry semantic noise — a reader's eye
 * catches accidental words — so a symbol-only set often reads as pure texture.
 */
export const SYMBOLS = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/** The classic density ramp, ordered dark to light. Cheap and predictable. */
export const RAMP = " .:-=+*#%@";

/**
 * A compact shape vocabulary made only from printable 7-bit ASCII.
 *
 * It mixes tonal marks, strokes, corners, curves, loops, junctions, letters,
 * and numbers while staying below the converter's 50-character palette limit.
 * It intentionally contains no block, box-drawing, Braille, or other specialty
 * drawing characters.
 */
export const SHAPE_ASCII = " .,:;'\"-_~^/\\|()[]<>+*=xXoO0Q8BuvnwmMWAilI17#%@";

/** Quadrant block characters. Maps cleanly onto a 2x2 zone grid. */
export const QUADRANTS = " ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█";

/** Shade blocks, for smooth tonal gradients without shape detail. */
export const SHADES = " ░▒▓█";

/** Box-drawing characters, which favour straight edges and corners. */
export const BOX = " ─│┌┐└┘├┤┬┴┼╭╮╰╯";
