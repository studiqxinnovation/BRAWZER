export type ProxyProtocol = "http" | "https" | "socks5";

export interface ProxyConfig {
  id: string;
  label: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  username?: string;
  password?: string;
  regions: string[];
  maxConcurrentSessions: number;
}

export interface ProxyAssignment {
  sessionId: string;
  proxyId: string;
  assignedAt: Date;
}

export interface IProxyRepository {
  listAll(): Promise<ProxyConfig[]>;
  findById(id: string): Promise<ProxyConfig | null>;
  countActiveSessions(proxyId: string): Promise<number>;
  assign(assignment: ProxyAssignment): Promise<void>;
  unassign(sessionId: string): Promise<void>;
  getAssignment(sessionId: string): Promise<ProxyAssignment | null>;
}

export class ProxyRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyRoutingError";
  }
}

export class ProxyRuleEngine {
  constructor(private readonly repo: IProxyRepository) {}

  async assign(sessionId: string, region?: string): Promise<ProxyAssignment> {
    const proxies = await this.repo.listAll();
    const candidates = region ? proxies.filter((p) => p.regions.includes(region)) : proxies;

    if (candidates.length === 0) {
      throw new ProxyRoutingError(
        region ? `No proxies available for region: ${region}` : "No proxies configured"
      );
    }

    const withCapacity = await Promise.all(
      candidates.map(async (p) => ({
        proxy: p,
        active: await this.repo.countActiveSessions(p.id),
      }))
    );

    const available = withCapacity.filter((e) => e.active < e.proxy.maxConcurrentSessions);
    if (available.length === 0) throw new ProxyRoutingError("All proxies at capacity");

    const chosen = available.reduce((best, cur) => (cur.active < best.active ? cur : best));
    const assignment: ProxyAssignment = { sessionId, proxyId: chosen.proxy.id, assignedAt: new Date() };
    await this.repo.assign(assignment);
    return assignment;
  }

  async release(sessionId: string): Promise<void> {
    await this.repo.unassign(sessionId);
  }

  async getAssignment(sessionId: string): Promise<ProxyAssignment | null> {
    return this.repo.getAssignment(sessionId);
  }

  buildProxyUrl(proxy: ProxyConfig): string {
    const auth = proxy.username && proxy.password ? `${proxy.username}:${proxy.password}@` : "";
    return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
  }
}
