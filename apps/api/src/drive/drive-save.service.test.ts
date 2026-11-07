import { describe, it, expect, vi, beforeEach } from "vitest";
import { DriveSaveService, IDriveClient, IDriveSaveRepository, IDownloadEvent } from "./drive-save.service";

const mockDriveClient: IDriveClient = {
  upload: vi.fn().mockResolvedValue({ fileId: "drive-file-123" }),
};

const mockRepo: IDriveSaveRepository = {
  save: vi.fn().mockResolvedValue(undefined),
  findBySession: vi.fn().mockResolvedValue([]),
  findByUser: vi.fn().mockResolvedValue([]),
};

const mockEvent: IDownloadEvent = {
  sessionId: "session-1",
  userId: "user-1",
  filename: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 204800,
  tempUrl: "https://stub-storage.local/dl/session-1/report.pdf",
};

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(204800)),
}) as unknown as typeof fetch;

describe("DriveSaveService", () => {
  let service: DriveSaveService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DriveSaveService(mockDriveClient, mockRepo);
  });

  it("fetches the temp file, uploads to Drive, and saves the record", async () => {
    const result = await service.handleDownload(mockEvent);
    expect(fetch).toHaveBeenCalledWith(mockEvent.tempUrl);
    expect(mockDriveClient.upload).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", filename: "report.pdf" })
    );
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ driveFileId: "drive-file-123", sessionId: "session-1" })
    );
    expect(result.driveFileId).toBe("drive-file-123");
  });

  it("throws when temp file fetch fails", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(service.handleDownload(mockEvent)).rejects.toThrow("Failed to fetch temp file");
  });
});
