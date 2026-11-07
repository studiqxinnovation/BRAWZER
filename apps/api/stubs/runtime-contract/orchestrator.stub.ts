import { ContainerSpec, ContainerHandle, IOrchestratorService } from "./browser-runtime.types";

export class StubOrchestratorService implements IOrchestratorService {
  private containers = new Map<string, ContainerHandle>();

  async startContainer(spec: ContainerSpec): Promise<ContainerHandle> {
    const handle: ContainerHandle = {
      sessionId: spec.sessionId,
      containerId: `stub-container-${spec.sessionId}`,
      wsEndpoint: `ws://localhost:9222/devtools/browser/${spec.sessionId}`,
      status: "ready",
      startedAt: new Date(),
    };
    this.containers.set(spec.sessionId, handle);
    return handle;
  }

  async stopContainer(sessionId: string): Promise<void> {
    this.containers.delete(sessionId);
  }

  async getStatus(sessionId: string): Promise<ContainerHandle | null> {
    return this.containers.get(sessionId) ?? null;
  }

  async listActive(): Promise<ContainerHandle[]> {
    return Array.from(this.containers.values()).filter(
      (h) => h.status === "ready" || h.status === "starting"
    );
  }
}
