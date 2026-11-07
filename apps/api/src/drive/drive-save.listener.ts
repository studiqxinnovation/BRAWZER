import { IBrowserEventBus } from "../../stubs/runtime-contract/browser-runtime.types";
import { DriveSaveService } from "./drive-save.service";

export class DriveSaveListener {
  private unsubscribe?: () => void;

  constructor(
    private readonly eventBus: IBrowserEventBus,
    private readonly driveSaveService: DriveSaveService,
    private readonly getUserIdForSession: (sessionId: string) => Promise<string | null>
  ) {}

  start(): void {
    this.unsubscribe = this.eventBus.on("download", async (event) => {
      const userId = await this.getUserIdForSession(event.sessionId);
      if (!userId) {
        console.warn(`[DriveSaveListener] No user found for session ${event.sessionId}, skipping save`);
        return;
      }

      const { filename, mimeType, sizeBytes, tempUrl } = event.payload as {
        filename: string;
        mimeType: string;
        sizeBytes: number;
        tempUrl: string;
      };

      try {
        const saved = await this.driveSaveService.handleDownload({
          sessionId: event.sessionId,
          userId,
          filename,
          mimeType,
          sizeBytes,
          tempUrl,
        });
        console.log(`[DriveSaveListener] Saved ${saved.filename} to Drive for user ${userId}`);
      } catch (err) {
        console.error(`[DriveSaveListener] Failed to save to Drive:`, err);
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }
}
