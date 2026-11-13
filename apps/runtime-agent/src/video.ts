import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { log } from "./log.ts";

/** Where Debian puts ffmpeg; without it the stream stays pictures only. */
const FFMPEG = "/usr/bin/ffmpeg";
/** Bits per second the encoder aims for, and its ceiling; a page at rest costs nothing. */
const BITRATE = "1600k";
const MAX_BITRATE = "2600k";
/** Frames between key frames: how long a viewer that missed one waits, at most. */
const KEYFRAME_EVERY = 48;
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
  ) {}

  start(): void {
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
        BITRATE,
        "-maxrate",
        MAX_BITRATE,
        "-bufsize",
        "1200k",
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
    log("info", "video encoder started", { width: this.width, height: this.height });
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
