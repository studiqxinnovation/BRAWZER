import { IGatewayService } from "./browser-runtime.types";

export class StubGatewayService implements IGatewayService {
  private openRelays = new Set<string>();

  async openRelay(sessionId: string, _clientWs: unknown): Promise<void> {
    this.openRelays.add(sessionId);
  }

  async closeRelay(sessionId: string): Promise<void> {
    this.openRelays.delete(sessionId);
  }

  isRelayOpen(sessionId: string): boolean {
    return this.openRelays.has(sessionId);
  }
}
