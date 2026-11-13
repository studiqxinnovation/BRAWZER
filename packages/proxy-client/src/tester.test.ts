import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { type Lookup, ProxyTester, type ProxyTesterOptions } from "./index.ts";

const echoUrl = new URL("http://127.0.0.1:9/echo");

/** Records every address dialled and fails it at once, so nothing leaves this machine. */
function refusingConnector() {
  const dialled: string[] = [];
  const connect = (address: string) => {
    dialled.push(address);
    const socket = new Socket();
    queueMicrotask(() => {
      socket.destroy(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }));
    });
    return socket;
  };
  return { dialled, connect };
}

function tester(options: Partial<ProxyTesterOptions>) {
  return new ProxyTester({ echoUrl, allowPrivate: false, ...options });
}

const target = (host: string) =>
  ({ protocol: "socks5", host, port: 1080, credentials: null }) as const;

describe("ProxyTester address checks", () => {
  it("resolves a name once and connects to exactly that answer", async () => {
    // A rebinding resolver: public the first time, loopback afterwards.
    let lookups = 0;
    const lookup: Lookup = () => {
      lookups += 1;
      return Promise.resolve([
        { address: lookups === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 },
      ]);
    };
    const { dialled, connect } = refusingConnector();
    const outcome = await tester({ lookup, connect }).test(target("proxy.example.com"));
    expect(lookups).toBe(1);
    expect(dialled).toEqual(["93.184.216.34"]);
    expect(outcome).toMatchObject({ ok: false, reachable: false, reason: "connection_refused" });
  });

  it("refuses a name if any of its addresses is private", async () => {
    const lookup: Lookup = () =>
      Promise.resolve([
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.7", family: 4 },
      ]);
    const { dialled, connect } = refusingConnector();
    const outcome = await tester({ lookup, connect }).test(target("mixed.example.com"));
    expect(outcome.reason).toBe("blocked_address");
    expect(dialled).toEqual([]);
  });

  it("refuses private, local and disguised addresses without connecting", async () => {
    const { dialled, connect } = refusingConnector();
    const subject = tester({ connect, lookup: () => Promise.reject(new Error("no lookups")) });
    for (const host of [
      "127.0.0.1",
      "[::1]",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "169.254.169.254",
      "0.0.0.0",
      "fd00:ec2::254",
      "100.100.100.200",
    ]) {
      expect((await subject.test(target(host))).reason, host).toBe("blocked_address");
    }
    for (const host of ["2130706433", "0x7f.1", "127.1", "0177.0.0.1", "fe80::1%en0"]) {
      expect((await subject.test(target(host))).reason, host).toBe("invalid_host");
    }
    expect(dialled).toEqual([]);
  });

  it("reports a name that doesn't resolve", async () => {
    const { connect } = refusingConnector();
    const outcome = await tester({
      connect,
      lookup: () => Promise.reject(Object.assign(new Error("not found"), { code: "ENOTFOUND" })),
    }).test(target("missing.example.com"));
    expect(outcome.reason).toBe("dns_failed");
  });

  it("gives up when the proxy doesn't answer in time", async () => {
    const outcome = await tester({
      allowPrivate: true,
      timeoutMs: 100,
      // A socket that never connects.
      connect: () => new Socket(),
    }).test(target("127.0.0.1"));
    expect(outcome).toMatchObject({ ok: false, reason: "timeout", reachable: false });
  });
});
