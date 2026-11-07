import { describe, it, expect, vi, beforeEach } from "vitest";
import { DriveSaveListener } from "./drive-save.listener";
import { DriveSaveService } from "./drive-save.service";
import { StubBrowserEventBus } from "../../stubs/runtime-contract/event-bus.stub";

const mockDriveSaveService = {
  handleDownload: vi.fn().mockResolvedValue({ driveFileId: "f-1", filename: "report.pdf" }),
} as unknown as DriveSaveService;

const getUserId = vi.fn().mockResolvedValue("user-1");

describe("DriveSaveListener", () => {
  let bus: StubBrowserEventBus;
  let listener: DriveSaveListener;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new StubBrowserEventBus();
    listener = new DriveSaveListener(bus, mockDriveSaveService, getUserId);
  });

  it("calls handleDownload when a download event fires", async () => {
    listener.start();
    bus.fakeDownload("session-1", "report.pdf");
    await Promise.resolve();
    expect(mockDriveSaveService.handleDownload).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", userId: "user-1", filename: "report.pdf" })
    );
  });

  it("skips save when no user found for session", async () => {
    getUserId.mockResolvedValueOnce(null);
    listener.start();
    bus.fakeDownload("session-orphan");
    await Promise.resolve();
    expect(mockDriveSaveService.handleDownload).not.toHaveBeenCalled();
  });

  it("does not call handleDownload after stop()", async () => {
    listener.start();
    listener.stop();
    bus.fakeDownload("session-1");
    await Promise.resolve();
    expect(mockDriveSaveService.handleDownload).not.toHaveBeenCalled();
  });
});
