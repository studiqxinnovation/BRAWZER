import { BrowserEvent, IBrowserEventBus } from "./browser-runtime.types";

type Handler = (e: BrowserEvent) => void;

export class StubBrowserEventBus implements IBrowserEventBus {
  private handlers = new Map<string, Set<Handler>>();
  public emitted: BrowserEvent[] = [];

  emit(event: BrowserEvent): void {
    this.emitted.push(event);
    const set = this.handlers.get(event.type);
    if (set) set.forEach((h) => h(event));
  }

  on(type: BrowserEvent["type"], handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  fakeDownload(sessionId: string, filename = "report.pdf") {
    this.emit({
      type: "download",
      sessionId,
      payload: {
        filename,
        mimeType: "application/pdf",
        sizeBytes: 204800,
        tempUrl: `https://stub-storage.local/dl/${sessionId}/${filename}`,
      },
      timestamp: new Date(),
    });
  }
}
