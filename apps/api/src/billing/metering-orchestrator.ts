import { IOrchestratorService, ContainerSpec, ContainerHandle } from "../../stubs/runtime-contract/browser-runtime.types";
import { ISessionMeterRepository } from "./metering";

export class MeteringOrchestrator implements IOrchestratorService {
  constructor(
    private readonly inner: IOrchestratorService,
    private readonly meters: ISessionMeterRepository
  ) {}

  async startContainer(spec: ContainerSpec): Promise<ContainerHandle> {
    const handle = await this.inner.startContainer(spec);
    await this.meters.start(spec.sessionId, spec.userId);
    return handle;
  }

  async stopContainer(sessionId: string): Promise<void> {
    await this.inner.stopContainer(sessionId);
    await this.meters.end(sessionId, 0);
  }

  async getStatus(sessionId: string): Promise<ContainerHandle | null> {
    return this.inner.getStatus(sessionId);
  }

  async listActive(): Promise<ContainerHandle[]> {
    return this.inner.listActive();
  }
}
