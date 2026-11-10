import type { ChromiumBrand } from "./config.ts";
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
  /**
   * Why the proxy refused `host:port` a moment ago, if it did: a tunnel the
   * engine reports as failed then gets Brawzer's own reason as its code.
   */
  refusalFor: (url: string) => string | null;
  /** The reader view script (Mozilla's Readability plus Brawzer's layout), ready to evaluate. */
  readerScript: string;
  /** Catalogue extensions to install for this session, with where their builds are in the image. */
  extensions: readonly InstallableExtension[];
  /**
   * Which Chromium browser this is: Brawzer's own Bee (which says so in its
   * user agent), or Chrome, Edge or Chromium as their makers ship them.
   */
  brand?: ChromiumBrand;
  /**
   * The browser's own pages a profile with its browser account on may open
   * (ADR 0021): its saved passwords, and its account sign-in where the
   * engine has one. Null: none.
   */
  browserPages?: { passwords: string; account: string | null } | null;
}

export interface InstallableExtension {
  slug: string;
  /** Chromium: the unpacked directory. Firefox: the signed xpi. */
  path: string;
}

/** Remembers the proxy's refusals briefly, keyed by `host:port`, for the engines' error pages. */
export class RefusalLog {
  private readonly entries = new Map<string, { reason: string; at: number }>();

  constructor(private readonly keepMs = 15_000) {}

  note(authority: string, reason: string): void {
    const key = authority.toLowerCase();
    this.entries.set(key, { reason, at: Date.now() });
    if (this.entries.size > 200) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /** The code for a page at `url`, as `BRAWZER_REFUSED_<REASON>`, or null. */
  codeFor(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    const key = `${parsed.hostname.replace(/^\[|\]$/g, "")}:${port}`.toLowerCase();
    const entry =
      this.entries.get(key) ?? this.entries.get(`${parsed.hostname}:${port}`.toLowerCase());
    if (!entry || Date.now() - entry.at > this.keepMs) return null;
    return `BRAWZER_REFUSED_${entry.reason.toUpperCase()}`;
  }
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
