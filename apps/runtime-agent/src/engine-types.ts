import type { AgentMessage, RelayMessage, TransferChunkHeader, Viewport } from "@brawzer/contracts";
import type { BinarySink } from "./transfers.ts";

/** Who is watching the stream right now, if anyone. */
export interface Viewer extends BinarySink {
  send(message: AgentMessage): void;
  /** False when the viewer can't take the frame right now; it is then dropped and acknowledged. */
  sendFrame(frame: Uint8Array): boolean;
}

export interface EngineOptions {
  /** Where the engine puts downloads and printed pages until they are handed over. */
  downloadDir: string;
  /** Where Drive files for a page's file chooser are written. */
  uploadDir: string;
  /** Drive's per-file limit: larger downloads are cancelled. */
  maxFileBytes: number;
  /** The page a new tab opens: Bee's own start page. */
  homeUrl: string;
}

/**
 * What the agent's server and lifecycle need from an engine, whichever it
 * is: Bee (Chromium over the DevTools pipe) or Firefox (WebDriver BiDi).
 */
export interface Engine {
  readonly isReady: boolean;
  start(): Promise<void>;
  attachViewer(viewer: Viewer, viewport: Viewport): void;
  detachViewer(viewer: Viewer): void;
  handle(message: RelayMessage): Promise<void>;
  receiveChunk(header: TransferChunkHeader, data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
