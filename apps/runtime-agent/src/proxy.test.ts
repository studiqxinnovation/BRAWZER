import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blockedPage, createFilteringProxy, decide, parseConnectTarget } from "./proxy.ts";

describe("decide", () => {
  const resolve = (name: string) =>
    Promise.resolve(
      {
        "example.com": ["93.184.216.34"],
        "rebind.example": ["93.184.216.34", "10.0.0.5"],
        "ipv6.example": ["2606:2800:220:1:248:1893:25c8:1946"],
        "nowhere.example": [],
      }[name] ?? Promise.reject(new Error("ENOTFOUND")),
    );

  it("allows public addresses and names", async () => {
    expect(await decide("example.com", 443, { resolve })).toEqual({
      address: "93.184.216.34",
      port: 443,
    });
    expect(await decide("93.184.216.34", 80, { resolve })).toEqual({
      address: "93.184.216.34",
      port: 80,
    });
    expect(await decide("ipv6.example", 443, { resolve })).toMatchObject({ port: 443 });
  });

  it("refuses private, local, reserved and partly-private targets", async () => {
    for (const host of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "192.168.1.1",
      "localhost",
      "[::1]",
      "::1",
      "0x7f.1",
      "rebind.example",
      "host.docker.internal",
    ]) {
      expect(await decide(host, 80, { resolve }), host).toMatchObject({ refused: "address" });
    }
    expect(await decide("nowhere.example", 80, { resolve })).toEqual({ refused: "unresolved" });
    expect(await decide("missing.example", 80, { resolve })).toEqual({ refused: "unresolved" });
    expect(await decide("example.com", 0, { resolve })).toEqual({ refused: "address" });
  });

  it("routes overridden names to the local test site only when configured", async () => {
    const overrides = new Map([["testsite.invalid", { host: "127.0.0.1", port: 8090 }]]);
    expect(await decide("testsite.invalid", 80, { resolve, overrides })).toEqual({
      address: "127.0.0.1",
      port: 8090,
    });
    expect(await decide("testsite.invalid", 80, { resolve })).toEqual({ refused: "unresolved" });
  });
});

describe("parseConnectTarget", () => {
  it("reads host:port, including bracketed IPv6", () => {
    expect(parseConnectTarget("example.com:443")).toEqual({ host: "example.com", port: 443 });
    expect(parseConnectTarget("[::1]:443")).toEqual({ host: "[::1]", port: 443 });
    expect(parseConnectTarget("example.com")).toBeNull();
    expect(parseConnectTarget("a:b:443")).toBeNull();
  });
});

describe("blockedPage", () => {
  it("escapes the host", () => {
    expect(blockedPage("<b>x</b>", { refused: "address" })).not.toContain("<b>");
    expect(blockedPage("nowhere.example", { refused: "unresolved" })).toContain(
      "couldn’t be found",
    );
  });
});

describe("filtering proxy", () => {
  let site: http.Server;
  let proxy: http.Server;
  let sitePort: number;
  let proxyPort: number;

  beforeAll(async () => {
    site = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`site saw ${req.headers.host ?? ""} ${req.url ?? ""}`);
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    sitePort = (site.address() as AddressInfo).port;
    proxy = createFilteringProxy({
      resolve: () => Promise.resolve(["10.0.0.1"]),
      overrides: new Map([["testsite.invalid", { host: "127.0.0.1", port: sitePort }]]),
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => site.close(resolve));
  });

  function viaProxy(url: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      http
        .get(
          { host: "127.0.0.1", port: proxyPort, path: url, headers: { host: new URL(url).host } },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          },
        )
        .on("error", reject);
    });
  }

  it("forwards allowed plain-HTTP requests with the original Host", async () => {
    const result = await viaProxy("http://testsite.invalid/hello?x=1");
    expect(result.status).toBe(200);
    expect(result.body).toBe("site saw testsite.invalid /hello?x=1");
  });

  it("answers refused requests with the blocked page", async () => {
    const result = await viaProxy(`http://127.0.0.1:${String(sitePort)}/secret`);
    expect(result.status).toBe(403);
    expect(result.body).toContain("Blocked by Brawzer");
    const byName = await viaProxy("http://private.example/");
    expect(byName.status).toBe(403);
  });

  it("refuses CONNECT to private addresses", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1",
        port: proxyPort,
        method: "CONNECT",
        path: `127.0.0.1:${String(sitePort)}`,
      });
      request.on("connect", (res) => resolve(res.statusCode ?? 0));
      request.on("error", reject);
      request.end();
    });
    expect(status).toBe(403);
  });
});
