import { type AgentMessage, type CursorKind, cursorSchema } from "@brawzer/contracts";
import { z } from "zod";
import { ICON_SCRIPT, pointerScript } from "./page-tools.ts";

/** What the pointer script answers; a cursor the viewer doesn't show counts as the arrow. */
const answerSchema = z.object({
  cursor: cursorSchema.catch("default"),
  hscroll: z.boolean().catch(false),
});

/** Pointer probes are no more frequent than this while the pointer moves. */
const POINTER_THROTTLE_MS = 60;

interface PointerTab {
  id: string;
}

interface IconTab {
  id: string;
  /** The icon last sent for this tab, as a data URL, or none. */
  icon: string | null;
  /** The address the icon was fetched from, so a page keeping its icon fetches nothing. */
  iconUrl: string | null;
}

/**
 * Tells the viewer what the pointer is over: the cursor to show and whether
 * a sideways swipe would scroll. Asked of the page a little after the
 * pointer moves, never more often than the throttle, and sent only when the
 * answer changes. Shared by both engines, which differ only in how they run
 * a script in a page.
 */
export class PointerReporter<T extends PointerTab> {
  private timer: NodeJS.Timeout | null = null;
  private pending: { tab: T; x: number; y: number } | null = null;
  private last: { tabId: string; cursor: CursorKind; hscroll: boolean } | null = null;

  constructor(
    private readonly evaluate: (tab: T, expression: string) => Promise<unknown>,
    private readonly send: (message: AgentMessage) => void,
    private readonly isCurrent: (tab: T) => boolean,
  ) {}

  report(tab: T, x: number, y: number): void {
    this.pending = { tab, x, y };
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, POINTER_THROTTLE_MS);
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.last = null;
  }

  private async run(): Promise<void> {
    const probe = this.pending;
    this.pending = null;
    if (!probe || !this.isCurrent(probe.tab)) return;
    let answer: unknown;
    try {
      const raw = await this.evaluate(probe.tab, pointerScript(probe.x, probe.y));
      answer = typeof raw === "string" ? JSON.parse(raw) : null;
    } catch {
      return;
    }
    const parsed = answerSchema.safeParse(answer);
    const kind: CursorKind = parsed.success ? parsed.data.cursor : "default";
    const hscroll = parsed.success && parsed.data.hscroll;
    const last = this.last;
    if (last?.tabId === probe.tab.id && last.cursor === kind && last.hscroll === hscroll) return;
    this.last = { tabId: probe.tab.id, cursor: kind, hscroll };
    if (this.isCurrent(probe.tab)) {
      this.send({ type: "pointer", tabId: probe.tab.id, cursor: kind, hscroll });
    }
  }
}

/**
 * Keeps the viewer's tab strip supplied with site icons: once a page has
 * loaded, asks it where its icon is, fetches it through the session's proxy
 * (the viewer never asks a site for anything) and sends it, or sends none so
 * a stale one is cleared.
 */
export class IconReporter<T extends IconTab> {
  constructor(
    private readonly evaluate: (tab: T, expression: string) => Promise<unknown>,
    private readonly fetchIcon: (url: string) => Promise<string | null>,
    private readonly send: (message: AgentMessage) => void,
  ) {}

  async refresh(tab: T): Promise<void> {
    let url: unknown;
    try {
      url = await this.evaluate(tab, ICON_SCRIPT);
    } catch {
      return;
    }
    if (typeof url !== "string" || url === tab.iconUrl) return;
    tab.iconUrl = url;
    const icon = await this.fetchIcon(url).catch(() => null);
    // The page moved on meanwhile: that fetch answers for it.
    if (tab.iconUrl !== url) return;
    tab.icon = icon;
    this.send({ type: "favicon", tabId: tab.id, icon });
  }

  /** A viewer that has just arrived gets every icon known. */
  resend(tabs: Iterable<T>): void {
    for (const tab of tabs) {
      if (tab.icon) this.send({ type: "favicon", tabId: tab.id, icon: tab.icon });
    }
  }
}
