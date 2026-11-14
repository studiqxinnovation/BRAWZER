import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { log } from "./log.ts";

/** Where Debian puts ffmpeg; without it the stream stays pictures only. */
const FFMPEG = "/usr/bin/ffmpeg";
/**
 * The most pixels the engine's frames of the page are taken at. Up to here a
 * frame is as dense as the viewer's screen, so the last one of a page that
 * stopped is itself its picture; beyond, taking them would slow the page down.
 */
const FRAME_MAX_PIXELS = 6_000_000;
/** Bits per second for each pixel of the picture, within the bounds below. */
const BITS_PER_PIXEL = 2.5;
const MIN_BITRATE = 2_500_000;
const TOP_BITRATE = 8_000_000;
/** A connection that fell behind gets the page at its own size and this much: it keeps up. */
const LEAN_BITRATE = 1_600_000;
/**
 * Frames between key frames. A key frame looks different from the frames
 * around it, so too many make the picture pulse; a viewer that lost one asks
 * for another (the encoder is started again) rather than waiting.
 */
const KEYFRAME_EVERY = 90;
/**
 * ffmpeg's JPEG parser hands a picture on only when the next one begins, so
 * the last picture before a pause would wait: after this long without
 * another, the same picture is fed once more to let it through.
 */
const FLUSH_AFTER_MS = 60;
/**
 * The encoder's threads: the processors the session's container may use
 * (BRAWZER_CPUS, set by the orchestrator), four at most. VP8 only spreads
 * over more than two when the picture is cut into as many partitions.
 */
export function encoderThreads(cpus: string | undefined): { threads: number; slices: number } {
  const count = Number(cpus);
  const threads = Number.isInteger(count) && count >= 1 ? Math.min(4, count) : 2;
  return { threads, slices: threads >= 4 ? 4 : 1 };
}
const ENCODER = encoderThreads(process.env.BRAWZER_CPUS);
/** The IVF container's file header, then a 12-byte header before each frame. */
const IVF_FILE_HEADER = 32;
const IVF_FRAME_HEADER = 12;

export interface EncodedFrame {
  key: boolean;
  data: Buffer;
}

/** Whether the container can encode video at all. */
export function videoAvailable(): boolean {
  try {
    accessSync(FFMPEG, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The viewer's pixel ratio, down to what keeps the picture within so many pixels; never under 1. */
function fittedScale(
  viewport: { width: number; height: number; scale: number },
  maxPixels: number,
): number {
  const fits = Math.sqrt(maxPixels / Math.max(1, viewport.width * viewport.height));
  return Math.max(1, Math.min(viewport.scale, fits));
}

/**
 * The size a moving page is drawn and encoded at: its own, whatever the
 * viewer's pixel ratio. Measured on the production host, an engine drawing
 * a scrolling page at twice the density gives a third of the frames, and
 * the encoder halves what is left: smooth matters more while a page moves,
 * and it has its picture at the screen's ratio the moment it stops.
 */
export function videoSize(viewport: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return { width: viewport.width, height: viewport.height };
}

/** The size the engine's frames of a page that isn't moving are asked for at: the viewer's pixel ratio, within bounds. */
export function frameSize(viewport: { width: number; height: number; scale: number }): {
  width: number;
  height: number;
} {
  const scale = fittedScale(viewport, FRAME_MAX_PIXELS);
  return {
    width: Math.round(viewport.width * scale),
    height: Math.round(viewport.height * scale),
  };
}

/** The most the engine may be asked to draw at: what the stream carries (BROWSER_LIMITS.viewport.maxScale). */
const ENGINE_MAX_SCALE = 2;
/** Two ratios this close are the same one: they are sent with two decimals. */
const SCALE_TOLERANCE = 0.011;

/**
 * The pixel ratio the engine is started at, from the body of the start
 * request: `{ "scale": 2 }`. Anything else, or none, is 1: the page's own size.
 */
export function startScale(body: string): number {
  let scale: unknown;
  try {
    scale = (JSON.parse(body) as { scale?: unknown } | null)?.scale;
  } catch {
    return 1;
  }
  if (typeof scale !== "number" || !Number.isFinite(scale)) return 1;
  return Math.min(ENGINE_MAX_SCALE, Math.max(1, Math.round(scale * 100) / 100));
}

/**
 * Whether the engine's frames are as dense as the viewer's screen: one is
 * then the still page's picture. The engine composes its pages at the ratio
 * it was started with (`engineScale`), whatever a page is told its screen's
 * is: its frames carry that many pixels and no more, so a viewer on a denser
 * screen than the one that opened the session gets the page's picture taken
 * separately instead.
 */
export function framesAreFull(
  viewport: { width: number; height: number; scale: number },
  engineScale: number,
): boolean {
  return (
    engineScale + SCALE_TOLERANCE >= viewport.scale &&
    fittedScale(viewport, FRAME_MAX_PIXELS) >= viewport.scale
  );
}

/** A JPEG's size in pixels, read from its frame header; null if it has none. */
export function jpegSize(jpeg: Buffer): { width: number; height: number } | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 <= jpeg.length) {
    if (jpeg[at] !== 0xff) return null;
    const marker = jpeg[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const length = jpeg.readUInt16BE(at + 2);
    // A start-of-frame marker (not the tables that share its range).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: jpeg.readUInt16BE(at + 7), height: jpeg.readUInt16BE(at + 5) };
    }
    at += 2 + length;
  }
  return null;
}

/**
 * The scale to send a picture of the page with: the viewer divides the
 * picture's pixels by it for the size on screen, which has to come out as
 * the page's own size exactly, whichever way the engine rounded.
 */
export function pictureScale(
  picture: { width: number; height: number },
  page: { width: number; height: number },
): number {
  const across = picture.width / Math.max(1, page.width);
  const down = picture.height / Math.max(1, page.height);
  const exact = (scale: number): boolean =>
    Math.round(picture.width / scale) === page.width &&
    Math.round(picture.height / scale) === page.height;
  const scale = [across, down, (across + down) / 2].find(exact) ?? across;
  return Math.max(1, scale);
}

/** What the encoder aims for, its ceiling and its buffer, in bits per second (and bits). */
export function videoRates(
  width: number,
  height: number,
  lean: boolean,
): { bitrate: number; ceiling: number; buffer: number } {
  const bitrate = lean
    ? LEAN_BITRATE
    : Math.min(TOP_BITRATE, Math.max(MIN_BITRATE, Math.round(width * height * BITS_PER_PIXEL)));
  return {
    bitrate,
    ceiling: Math.round(bitrate * 1.6),
    buffer: Math.round(bitrate * 0.75),
  };
}

/**
 * Turns the engine's pictures of a moving page into VP8, one ffmpeg per
 * page size: JPEG frames in, encoded frames out, parsed from the IVF it
 * writes. Realtime settings: it keeps up rather than looks its best, since
 * a still page gets its own sharp picture anyway. A frame the encoder
 * can't take yet is skipped, never queued.
 */
export class FrameEncoder {
  private child: ChildProcess | null = null;
  private pending: Buffer = Buffer.alloc(0);
  private headerSeen = false;
  private writable = true;
  private reported = false;
  private last: Buffer | null = null;
  private flush: NodeJS.Timeout | null = null;
  /** Pictures given to ffmpeg, and frames it has given back. */
  private written = 0;
  private emitted = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly onFrame: (frame: EncodedFrame) => void,
    /** For a connection that fell behind: less to send, so it keeps up. */
    readonly lean = false,
  ) {}

  start(): void {
    const rates = videoRates(this.width, this.height, this.lean);
    const child = spawn(
      FFMPEG,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        // One picture must be enough to start: no probing for more. The mjpeg
        // demuxer hands each picture on as the next begins (image2pipe would
        // hold them all until the input closed).
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-f",
        "mjpeg",
        "-framerate",
        "30",
        "-i",
        "pipe:0",
        "-vf",
        `scale=${String(this.width)}:${String(this.height)}`,
        "-c:v",
        "libvpx",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-threads",
        String(ENCODER.threads),
        ...(ENCODER.slices > 1 ? ["-slices", String(ENCODER.slices)] : []),
        "-lag-in-frames",
        "0",
        "-error-resilient",
        "1",
        "-b:v",
        String(rates.bitrate),
        "-maxrate",
        String(rates.ceiling),
        "-bufsize",
        String(rates.buffer),
        // Text stays readable: the encoder may not trade it away to save bits.
        "-qmin",
        "4",
        "-qmax",
        this.lean ? "56" : "46",
        "-g",
        String(KEYFRAME_EVERY),
        "-flush_packets",
        "1",
        "-f",
        "ivf",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stdout.on("data", (data: Buffer) => {
      this.consume(data);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      const line = text.trim();
      if (line) log("warn", "video encoder", { line: line.slice(0, 300) });
    });
    child.stdin.on("drain", () => {
      this.writable = true;
    });
    child.stdin.on("error", () => undefined);
    child.on("exit", (code) => {
      if (this.child === child) {
        this.child = null;
        if (code !== 0 && code !== null) log("warn", "video encoder exited", { code });
      }
    });
    child.on("error", (error) => {
      log("warn", "video encoder could not start", { message: error.message });
    });
    this.child = child;
    log("info", "video encoder started", {
      width: this.width,
      height: this.height,
      bitrate: rates.bitrate,
      lean: this.lean,
    });
  }

  /** One picture of the page; false if the encoder is behind and this one is skipped. */
  push(jpeg: Buffer): boolean {
    if (this.flush) clearTimeout(this.flush);
    this.flush = null;
    const written = this.write(jpeg);
    if (written) {
      this.last = jpeg;
      this.flush = setTimeout(() => {
        this.flush = null;
        if (this.last) this.write(this.last);
      }, FLUSH_AFTER_MS);
    }
    return written;
  }

  private write(jpeg: Buffer): boolean {
    const stdin = this.child?.stdin;
    if (!stdin || !this.writable || stdin.destroyed) return false;
    this.writable = stdin.write(jpeg);
    this.written += 1;
    return true;
  }

  /**
   * Whether video of a picture it was given is still to come out. ffmpeg
   * hands a picture on as the next begins, so the last one written (the
   * repeat that flushes) is always still inside.
   */
  get busy(): boolean {
    return this.child !== null && (this.flush !== null || this.written - this.emitted > 1);
  }

  stop(): void {
    if (this.flush) clearTimeout(this.flush);
    this.flush = null;
    this.last = null;
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.stdin?.end();
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 1_000).unref();
  }

  get running(): boolean {
    return this.child !== null;
  }

  private consume(data: Buffer): void {
    this.pending = this.pending.length === 0 ? data : Buffer.concat([this.pending, data]);
    if (!this.headerSeen) {
      if (this.pending.length < IVF_FILE_HEADER) return;
      this.pending = this.pending.subarray(IVF_FILE_HEADER);
      this.headerSeen = true;
    }
    for (;;) {
      if (this.pending.length < IVF_FRAME_HEADER) return;
      const size = this.pending.readUInt32LE(0);
      if (this.pending.length < IVF_FRAME_HEADER + size) return;
      const frame = Buffer.from(this.pending.subarray(IVF_FRAME_HEADER, IVF_FRAME_HEADER + size));
      this.pending = this.pending.subarray(IVF_FRAME_HEADER + size);
      // A VP8 frame tag's lowest bit is 0 for a key frame.
      const key = frame.length > 0 && ((frame[0] ?? 1) & 1) === 0;
      if (!this.reported) {
        this.reported = true;
        log("info", "video encoder producing", { bytes: frame.length, key });
      }
      this.emitted += 1;
      this.onFrame({ key, data: frame });
    }
  }
}
