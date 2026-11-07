import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeteringOrchestrator } from "./metering-orchestrator";
import { StubOrchestratorService } from "../../stubs/runtime-contract/orchestrator.stub";
import { ISessionMeterRepository, SessionMeter } from "./metering";

const mockMeters: ISessionMeterRepository = {
  start: vi.fn().mockResolvedValue(undefined),
  end: vi.fn().mockResolvedValue({
    sessionId: "s1", userId: "u1",
    startedAt: new Date(), endedAt: new Date(),
    durationMs: 5000, bytesTransferred: 0,
  } as SessionMeter),
  findByUser: vi.fn().mockResolvedValue([]),
  findBySession: vi.fn().mockResolvedValue(null),
};

describe("MeteringOrchestrator", () => {
  let orchestrator: MeteringOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new MeteringOrchestrator(new StubOrchestratorService(), mockMeters);
  });

  it("starts a container and records meter start", async () => {
    const handle = await orchestrator.startContainer({ sessionId: "s1", userId: "u1" });
    expect(handle.sessionId).toBe("s1");
    expect(mockMeters.start).toHaveBeenCalledWith("s1", "u1");
  });

  it("stops a container and records meter end", async () => {
    await orchestrator.startContainer({ sessionId: "s1", userId: "u1" });
    await orchestrator.stopContainer("s1");
    expect(mockMeters.end).toHaveBeenCalledWith("s1", 0);
  });

  it("delegates getStatus to inner orchestrator", async () => {
    await orchestrator.startContainer({ sessionId: "s1", userId: "u1" });
    const status = await orchestrator.getStatus("s1");
    expect(status?.sessionId).toBe("s1");
  });

  it("delegates listActive to inner orchestrator", async () => {
    await orchestrator.startContainer({ sessionId: "s1", userId: "u1" });
    const active = await orchestrator.listActive();
    expect(active.length).toBe(1);
  });
});
