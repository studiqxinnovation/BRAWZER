import { type FrameHeader, PICTURES_KEPT } from "@brawzer/contracts";

/**
 * The pictures of the page the agent asked this viewer to keep: the newest
 * few, so that a page that looks again as it did a moment ago (a cursor
 * blinking on and off) is shown from here instead of being sent again.
 * Held as they arrived, a JPEG each; nothing is kept past the connection.
 */
export class KeptPictures {
  private readonly kept = new Map<number, Uint8Array<ArrayBuffer>>();

  /**
   * The image to show for a frame: its own, or the kept one it names. Null
   * when that one isn't here (it was dropped on the way while this page was
   * behind): the agent is then asked for the picture itself.
   */
  take(header: FrameHeader, image: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
    if (header.again !== undefined) return this.kept.get(header.again) ?? null;
    if (header.keep) {
      this.kept.set(header.frameId, image);
      for (const oldest of this.kept.keys()) {
        if (this.kept.size <= PICTURES_KEPT) break;
        this.kept.delete(oldest);
      }
    }
    return image;
  }

  clear(): void {
    this.kept.clear();
  }
}
