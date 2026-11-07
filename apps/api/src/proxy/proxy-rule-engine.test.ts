import { describe, it, expect, vi } from "vitest";
import { ProxyRuleEngine, ProxyRoutingError, IProxyRepository, ProxyConfig } from "./proxy-rule-engine";

const makeProxy = (id: string, region: string, max = 10): ProxyConfig => ({
  id, label: id, host: `${id}.proxy.local`, port: 1080,
  protocol: "socks5", regions: [region], maxConcurrentSessions: max,
});

const makeRepo = (proxies: ProxyConfig[], activeCounts: Record<string, number> = {}): IProxyRepository => ({
  listAll: vi.fn().mockResolvedValue(proxies),
  findById: vi.fn().mockImplementation((id) => Promise.resolve(proxies.find((p) => p.id === id) ?? null)),
  countActiveSessions: vi.fn().mockImplementation((id) => Promise.resolve(activeCounts[id] ?? 0)),
  assign: vi.fn().mockResolvedValue(undefined),
  unassign: vi.fn().mockResolvedValue(undefined),
  getAssignment: vi.fn().mockResolvedValue(null),
});

describe("ProxyRuleEngine", () => {
  it("assigns the least-loaded proxy", async () => {
    const repo = makeRepo([makeProxy("p1","eu"), makeProxy("p2","eu")], { p1:5, p2:2 });
    expect((await new ProxyRuleEngine(repo).assign("s1")).proxyId).toBe("p2");
  });

  it("filters by region when provided", async () => {
    const repo = makeRepo([makeProxy("p-eu","eu"), makeProxy("p-us","us")]);
    expect((await new ProxyRuleEngine(repo).assign("s1","us")).proxyId).toBe("p-us");
  });

  it("throws when no proxies match region", async () => {
    const repo = makeRepo([makeProxy("p-eu","eu")]);
    await expect(new ProxyRuleEngine(repo).assign("s1","ap")).rejects.toThrow(ProxyRoutingError);
  });

  it("throws when all proxies at capacity", async () => {
    const repo = makeRepo([makeProxy("p1","eu",2)], { p1:2 });
    await expect(new ProxyRuleEngine(repo).assign("s1")).rejects.toThrow("All proxies at capacity");
  });

  it("throws when no proxies configured", async () => {
    await expect(new ProxyRuleEngine(makeRepo([])).assign("s1")).rejects.toThrow("No proxies configured");
  });

  it("releases a session", async () => {
    const repo = makeRepo([makeProxy("p1","eu")]);
    await new ProxyRuleEngine(repo).release("s1");
    expect(repo.unassign).toHaveBeenCalledWith("s1");
  });

  it("builds proxy URL with auth", () => {
    const proxy: ProxyConfig = { id:"p1", label:"p1", host:"proxy.local", port:1080,
      protocol:"socks5", username:"user", password:"pass", regions:["eu"], maxConcurrentSessions:10 };
    expect(new ProxyRuleEngine({} as IProxyRepository).buildProxyUrl(proxy)).toBe("socks5://user:pass@proxy.local:1080");
  });

  it("builds proxy URL without auth", () => {
    const proxy: ProxyConfig = { id:"p1", label:"p1", host:"proxy.local", port:1080,
      protocol:"http", regions:["eu"], maxConcurrentSessions:10 };
    expect(new ProxyRuleEngine({} as IProxyRepository).buildProxyUrl(proxy)).toBe("http://proxy.local:1080");
  });
});
