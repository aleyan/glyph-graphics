/**
 * Plays a baked ASCII video straight to an ANSI terminal, outside any renderer.
 */
import {
  createAsciiVideoCursor,
  type AsciiVideo,
} from "./codec.js";

export const TERMINAL_ALT_SCREEN_ENTER = "\x1b[?1049h";
export const TERMINAL_ALT_SCREEN_LEAVE = "\x1b[?1049l";
export const TERMINAL_CURSOR_HIDE = "\x1b[?25l";
export const TERMINAL_CURSOR_SHOW = "\x1b[?25h";

export type Rgb = readonly [number, number, number] | [number, number, number];

export interface Point {
  x: number;
  y: number;
}

/**
 * Repaints only the cells that changed since the last painted frame. A full
 * truecolor repaint is heavy; the deltas the format already carries are what
 * make high frame rates reachable over ANSI output.
 */
export interface AsciiVideoPainter {
  /** ANSI bringing the screen from the last painted frame to these cells. */
  paint: (glyphs: readonly string[], colors: Uint8Array) => string;
}

export function createAsciiVideoPainter(
  video: AsciiVideo,
  origin: Point = { x: 0, y: 0 },
): AsciiVideoPainter {
  const cells = video.cols * video.rows;
  const paintedGlyphs = new Array<string>(cells).fill("");
  const paintedColors = new Int16Array(cells).fill(-1);
  const foreground = video.paletteRgb;
  let currentColor = -1;

  return {
    paint: (glyphs, colors) => {
      let output = "";
      for (let row = 0; row < video.rows; row++) {
        const rowStart = row * video.cols;
        let col = 0;
        while (col < video.cols) {
          const cell = rowStart + col;
          if (glyphs[cell] === paintedGlyphs[cell] && colors[cell] === paintedColors[cell]) {
            col++;
            continue;
          }
          // One cursor move per contiguous stretch of changed cells; SGR state
          // survives the move, so color is re-sent only when it actually changes.
          output += `\x1b[${origin.y + row + 1};${origin.x + col + 1}H`;
          while (col < video.cols) {
            const changing = rowStart + col;
            if (
              glyphs[changing] === paintedGlyphs[changing] &&
              colors[changing] === paintedColors[changing]
            ) break;
            const index = colors[changing]!;
            if (index !== currentColor) {
              const offset = index * 3;
              output +=
                `\x1b[38;2;${foreground[offset]};${foreground[offset + 1]};${foreground[offset + 2]}m`;
              currentColor = index;
            }
            output += glyphs[changing]!;
            paintedGlyphs[changing] = glyphs[changing]!;
            paintedColors[changing] = index;
            col++;
          }
        }
      }
      return output;
    },
  };
}

export interface TimerHost<Handle> {
  setTimeout: (handler: () => void, timeout: number) => Handle;
  clearTimeout: (handle: Handle) => void;
}

export interface AsciiVideoPlaybackOptions<Handle = unknown> {
  video: AsciiVideo;
  /** Where the grid's top-left cell sits on screen, zero-based. Defaults to (0, 0). */
  origin?: Point;
  write: (text: string) => void;
  /** Paper color, painted once behind the whole grid. */
  background: Rgb;
  now?: () => number;
  timer?: TimerHost<Handle>;
}

export interface AsciiVideoPlayback {
  finished: Promise<void>;
  /** Ends playback early, leaving the last painted frame on screen. */
  stop: () => void;
}

/** Opening sequence: hide the cursor and lay down the paper the glyphs sit on. */
export function asciiVideoOpening(background: Rgb): string {
  return `${TERMINAL_CURSOR_HIDE}\x1b[48;2;${background[0]};${background[1]};${background[2]}m\x1b[2J`;
}

/** Closing sequence: drop the paint state and clear, ready for whatever renders next. */
export function asciiVideoClosing(): string {
  return `\x1b[0m\x1b[2J\x1b[H${TERMINAL_CURSOR_SHOW}`;
}

/**
 * Plays the video in real time, dropping frames rather than falling behind:
 * the playhead comes from the clock, and skipped frames cost only their deltas
 * because the painter compares against what is actually on screen.
 */
export function playAsciiVideo<Handle = unknown>(
  options: AsciiVideoPlaybackOptions<Handle>,
): AsciiVideoPlayback {
  const { video, write } = options;
  const origin = options.origin ?? { x: 0, y: 0 };
  const now = options.now ?? (() => Date.now());
  const timer = options.timer ?? ({
    setTimeout: (handler: () => void, timeout: number) =>
      globalThis.setTimeout(handler, timeout) as unknown as Handle,
    clearTimeout: (handle: Handle) =>
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof globalThis.setTimeout>),
  } as TimerHost<Handle>);

  const cursor = createAsciiVideoCursor(video);
  const painter = createAsciiVideoPainter(video, origin);
  const start = now();
  let handle: Handle | null = null;
  let stopped = false;
  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (handle !== null) timer.clearTimeout(handle);
    handle = null;
    resolveFinished();
  };

  const draw = (index: number) => {
    cursor.seek(index);
    const output = painter.paint(cursor.glyphs, cursor.colors);
    if (output) write(output);
  };

  const step = () => {
    if (stopped) return;
    handle = null;
    const elapsed = now() - start;
    const index = Math.floor(elapsed * video.fps / 1000);
    if (index >= video.frameCount - 1) {
      draw(video.frameCount - 1);
      stop();
      return;
    }
    draw(index);
    const nextDue = start + (index + 1) * 1000 / video.fps;
    handle = timer.setTimeout(step, Math.max(0, nextDue - now()));
  };

  write(asciiVideoOpening(options.background));
  step();

  return { finished, stop };
}
