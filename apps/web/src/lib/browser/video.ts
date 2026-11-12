import type { VideoChunkHeader, VideoCodec } from "@brawzer/contracts";

/**
 * Decodes the moving page's video (ADR 0006, addendum) with the browser's
 * own decoder (WebCodecs): each chunk from the relay is one frame, and
 * every decoded frame is handed over to be drawn at once. A chunk missed
 * (a gap in the sequence, or a decoder error) means the frames that follow
 * can't be used: the player waits for a key frame and asks for one.
 */
export class VideoPlayer {
  private decoder: VideoDecoder | null = null;
  private configured: { codec: VideoCodec; width: number; height: number } | null = null;
  private nextSeq: number | null = null;
  private waitingForKey = true;
  private closed = false;

  constructor(
    private readonly onFrame: (frame: VideoFrame, header: VideoChunkHeader) => void,
    private readonly onLost: () => void,
  ) {}

  push(header: VideoChunkHeader, data: Uint8Array): void {
    if (this.closed || typeof VideoDecoder === "undefined") return;
    const gap = this.nextSeq !== null && header.seq !== this.nextSeq;
    this.nextSeq = header.seq + 1;
    if (gap && !header.key) {
      this.lose();
      return;
    }
    const current = this.configured;
    if (!this.decoder || current?.width !== header.width || current.height !== header.height) {
      if (!header.key) {
        this.waitingForKey = true;
        return;
      }
      this.configure(header);
    }
    if (this.waitingForKey && !header.key) return;
    this.waitingForKey = false;
    try {
      this.decoder?.decode(
        new EncodedVideoChunk({
          type: header.key ? "key" : "delta",
          timestamp: header.seq * 33_333,
          data,
        }),
      );
    } catch {
      this.lose();
    }
  }

  close(): void {
    this.closed = true;
    this.drop();
  }

  private configure(header: VideoChunkHeader): void {
    this.drop();
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (this.decoder !== decoder || this.closed) {
          frame.close();
          return;
        }
        this.onFrame(frame, header);
      },
      error: () => {
        if (this.decoder === decoder) this.lose();
      },
    });
    decoder.configure({
      codec: header.codec,
      codedWidth: header.width,
      codedHeight: header.height,
      optimizeForLatency: true,
    });
    this.decoder = decoder;
    this.configured = { codec: header.codec, width: header.width, height: header.height };
    this.waitingForKey = true;
  }

  /** The decoder can't go on from here: it starts again from the next key frame, asked for now. */
  private lose(): void {
    this.drop();
    this.waitingForKey = true;
    if (!this.closed) this.onLost();
  }

  private drop(): void {
    const decoder = this.decoder;
    this.decoder = null;
    this.configured = null;
    if (decoder && decoder.state !== "closed") decoder.close();
  }
}

/** The codecs this browser can decode, offered to the agent; none means pictures only. */
export async function detectVideoCodecs(): Promise<VideoCodec[]> {
  if (typeof VideoDecoder === "undefined") return [];
  try {
    const support = await VideoDecoder.isConfigSupported({ codec: "vp8" });
    return support.supported ? ["vp8"] : [];
  } catch {
    return [];
  }
}
