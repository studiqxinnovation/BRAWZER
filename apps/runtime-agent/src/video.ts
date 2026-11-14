import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { log } from "./log.ts";

/** Where Debian puts ffmpeg; without it the stream stays pictures only. */
const FFMPEG = "/usr/bin/ffmpeg";
/**
 * The most pixels a moving page is encoded at: beyond a 2560×1440 screen's
 * worth the encoder would fall behind the page, and smooth matters more.
 */
const VIDEO_MAX_PIXELS = 2560 * 1440;
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

/**
 * The size a moving page is encoded at: the viewer's own pixel ratio, so a
 * page looks the same moving as still, down to what the encoder can keep up
 * with; the page's own size (scale 1) for a connection that fell behind.
 */
export function videoSize(
  viewport: { width: number; height: number; scale: number },
  lean: boolean,
): { width: number; height: number } {
  const fits = Math.sqrt(VIDEO_MAX_PIXELS / Math.max(1, viewport.width * viewport.height));
  const scale = lean ? 1 : Math.max(1, Math.min(viewport.scale, fits));
  return {
    width: Math.round(viewport.width * scale),
    height: Math.round(viewport.height * scale),
  };
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
        "2",
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
    return true;
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
      this.onFrame({ key, data: frame });
    }
  }
}
