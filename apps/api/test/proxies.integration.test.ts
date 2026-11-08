import {
  accountExportSchema,
  profileListSchema,
  proxyListSchema,
  proxySchema,
  proxyTestResultSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProxyTester } from "@brawzer/proxy-client";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";
import {
  echoServer,
  httpProxy,
  httpsProxy,
  socks5Proxy,
  testCertificate,
  type TestServer,
} from "./support/proxy-servers.js";

// Requires the local services: `pnpm infra:up`. The proxies and the echo
// server run on 127.0.0.1, so this harness turns on the test-only flag that
// allows private addresses; `strict` runs with production rules.
let h: Harness;
let strict: Harness;
let echo: TestServer;
const servers: TestServer[] = [];
const AUTH = { username: "tester", password: "c0rrect-h0rse" };

beforeAll(async () => {
  echo = await echoServer();
  const echoUrl = `http://127.0.0.1:${String(echo.port)}/ip`;
  h = await createHarness({
    ipPrefix: "100.65.0",
    env: { PROXY_TEST_ALLOW_PRIVATE: "true", PROXY_TEST_URL: echoUrl },
  });
  strict = await createHarness({
    ipPrefix: "100.66.0",
    env: { PROXY_TEST_ALLOW_PRIVATE: "false", PROXY_TEST_URL: echoUrl },
  });
});

afterAll(async () => {
  await h.close();
  await strict.close();
  await Promise.all([echo, ...servers].map((server) => server.close()));
});

async function started<T extends TestServer>(server: Promise<T>): Promise<T> {
  const running = await server;
  servers.push(running);
  return running;
}

async function account(harness: Harness, tag: string): Promise<TestBrowser> {
  const client = harness.browser();
  await harness.signUp(client, harness.uniqueEmail(tag), "violet-harbor-lantern");
  return client;
}

async function addProxy(client: TestBrowser, body: object) {
  const response = await client.post("/proxies", body);
  expect(response.statusCode, response.body).toBe(201);
  return proxySchema.parse(response.json());
}

async function runTest(client: TestBrowser, id: string) {
  const response = await client.post(`/proxies/${id}/test`);
  expect(response.statusCode, response.body).toBe(200);
  return proxyTestResultSchema.parse(response.json());
}

describe("saving proxies", () => {
  it("keeps credentials encrypted and never returns them", async () => {
    const client = await account(h, "proxy-save");
    const socks = await started(socks5Proxy(AUTH));
    const proxy = await addProxy(client, {
      name: "Frankfurt",
      protocol: "socks5",
      host: "127.0.0.1",
      port: socks.port,
      kind: "datacenter",
      credentials: AUTH,
    });
    expect(proxy).toMatchObject({
      hasCredentials: true,
      lastTest: null,
      kind: "datacenter",
      rotation: "unknown",
    });

    const listed = await client.get("/proxies");
    expect(listed.body).not.toContain(AUTH.password);
    expect(listed.body).not.toContain(AUTH.username);
    expect(proxyListSchema.parse(listed.json())).toMatchObject({ limit: 20 });

    const { rows } = await h.database.pool.query<{ credentials: string }>(
      "select credentials from proxies where id = $1",
      [proxy.id],
    );
    expect(rows[0]?.credentials.startsWith("v1.")).toBe(true);
    expect(rows[0]?.credentials).not.toContain(AUTH.password);
  });

  it("refuses private and local hosts, and credentials a protocol can't carry", async () => {
    const client = await account(strict, "proxy-refuse");
    const cases: [object, string][] = [
      [
        { host: "127.0.0.1" },
        "host: Brawzer doesn’t connect to private, local or reserved network addresses.",
      ],
      [
        { host: "localhost" },
        "host: Brawzer doesn’t connect to private, local or reserved network addresses.",
      ],
      [
        { host: "[::ffff:10.0.0.1]" },
        "host: Brawzer doesn’t connect to private, local or reserved network addresses.",
      ],
      [{ host: "2130706433" }, "host: Enter a host name or IP address, such as proxy.example.com."],
      [
        { host: "user:pass@proxy.example.com" },
        "host: Enter only the host name or IP address, without a scheme, path or password.",
      ],
      [
        { protocol: "socks4", credentials: { username: "me", password: "secret" } },
        "credentials.password: SOCKS4 proxies take a user ID only, not a password.",
      ],
      [
        { protocol: "http", credentials: { username: "me:you", password: "x" } },
        "credentials.username: An HTTP proxy username can’t contain a colon.",
      ],
      [{ port: 70_000 }, "port: Use a port from 1 to 65535."],
    ];
    for (const [overrides, detail] of cases) {
      const response = await client.post("/proxies", {
        name: "Bad",
        protocol: "socks5",
        host: "proxy.example.com",
        port: 1080,
        ...overrides,
      });
      expect(response.statusCode, JSON.stringify(overrides)).toBe(400);
      expect(strict.errorOf(response).details).toContain(detail);
    }
  });

  it("stops at the limit and refuses duplicate names", async () => {
    const client = await account(h, "proxy-limit");
    for (let i = 1; i <= 20; i++) {
      await addProxy(client, {
        name: `Proxy ${String(i)}`,
        protocol: "http",
        host: "proxy.example.com",
        port: 8000 + i,
      });
    }
    const over = await client.post("/proxies", {
      name: "One more",
      protocol: "http",
      host: "proxy.example.com",
      port: 9000,
    });
    expect(over.statusCode).toBe(409);
    expect(h.errorOf(over).code).toBe("limit_reached");
    const client2 = await account(h, "proxy-duplicate");
    await addProxy(client2, {
      name: "Work",
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
    });
    const duplicate = await client2.post("/proxies", {
      name: "WORK",
      protocol: "http",
      host: "proxy.example.com",
      port: 8081,
    });
    expect(duplicate.statusCode).toBe(409);
  });
});

describe("testing proxies", () => {
  it("works through SOCKS5 with credentials and reports the exit address", async () => {
    const client = await account(h, "proxy-socks");
    const socks = await started(socks5Proxy(AUTH));
    const proxy = await addProxy(client, {
      name: "SOCKS",
      protocol: "socks5",
      host: "127.0.0.1",
      port: socks.port,
      credentials: AUTH,
    });
    const result = await runTest(client, proxy.id);
    expect(result, JSON.stringify(result)).toMatchObject({
      ok: true,
      reachable: true,
      authenticated: true,
      exitAddress: "127.0.0.1",
      reason: null,
      message: "The proxy works.",
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    // The proxy was asked for the fixed echo destination, nothing else.
    expect(socks.requests).toEqual([`127.0.0.1:${String(echo.port)}`]);
    // The result is kept.
    const [listed] = proxyListSchema.parse((await client.get("/proxies")).json()).proxies;
    expect(listed?.lastTest?.ok).toBe(true);

    // Wrong credentials: the change clears the old result, and the test explains.
    const changed = await client.patch(`/proxies/${proxy.id}`, {
      credentials: { username: AUTH.username, password: "wrong" },
    });
    expect(proxySchema.parse(changed.json()).lastTest).toBeNull();
    expect(await runTest(client, proxy.id)).toMatchObject({
      ok: false,
      reachable: true,
      authenticated: false,
      reason: "auth_failed",
      message: "The proxy didn’t accept the username or password.",
    });
  });

  it("works through HTTP CONNECT, and explains a missing password", async () => {
    const client = await account(h, "proxy-http");
    const proxyServer = await started(httpProxy(AUTH));
    const withAuth = await addProxy(client, {
      name: "HTTP",
      protocol: "http",
      host: "127.0.0.1",
      port: proxyServer.port,
      credentials: AUTH,
    });
    expect(await runTest(client, withAuth.id)).toMatchObject({
      ok: true,
      exitAddress: "127.0.0.1",
    });

    const withoutAuth = await addProxy(client, {
      name: "HTTP without password",
      protocol: "http",
      host: "127.0.0.1",
      port: proxyServer.port,
    });
    expect(await runTest(client, withoutAuth.id)).toMatchObject({
      ok: false,
      reason: "auth_failed",
    });
  });

  it("explains a proxy that isn't there", async () => {
    const client = await account(h, "proxy-down");
    const gone = await started(socks5Proxy());
    await gone.close();
    const proxy = await addProxy(client, {
      name: "Gone",
      protocol: "socks5",
      host: "127.0.0.1",
      port: gone.port,
    });
    expect(await runTest(client, proxy.id)).toMatchObject({
      ok: false,
      reachable: false,
      authenticated: null,
      reason: "connection_refused",
    });
  });

  it("refuses a private address at test time too, even if one was stored", async () => {
    const client = await account(strict, "proxy-stored-private");
    const proxy = await addProxy(client, {
      name: "Sneaky",
      protocol: "socks5",
      host: "proxy.example.com",
      port: 1080,
    });
    // Bypass the API's checks, as if the rules had changed since it was saved.
    await strict.database.pool.query("update proxies set host = '127.0.0.1' where id = $1", [
      proxy.id,
    ]);
    expect(await runTest(client, proxy.id)).toMatchObject({
      ok: false,
      reason: "blocked_address",
      reachable: false,
    });
  });

  it("runs at most two tests at a time per account", async () => {
    const client = await account(h, "proxy-busy");
    const slow = await started(httpProxy(undefined, 400));
    const proxy = await addProxy(client, {
      name: "Slow",
      protocol: "http",
      host: "127.0.0.1",
      port: slow.port,
    });
    const responses = await Promise.all(
      [1, 2, 3].map(() => client.post(`/proxies/${proxy.id}/test`)),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 200, 429]);
  });

  it("verifies an HTTPS proxy's certificate", async () => {
    const certificate = testCertificate();
    const secure = await started(httpsProxy(certificate));
    const echoUrl = new URL(`http://127.0.0.1:${String(echo.port)}/ip`);
    const target = {
      protocol: "https",
      host: "127.0.0.1",
      port: secure.port,
      credentials: null,
    } as const;

    const trusting = new ProxyTester({
      echoUrl,
      allowPrivate: true,
      tls: { ca: certificate.cert },
    });
    expect(await trusting.test(target)).toMatchObject({ ok: true, exitAddress: "127.0.0.1" });

    const untrusting = new ProxyTester({ echoUrl, allowPrivate: true });
    expect(await untrusting.test(target)).toMatchObject({
      ok: false,
      reachable: true,
      reason: "tls_failed",
    });
  });
});

describe("proxies and profiles", () => {
  it("assigns a proxy to a profile, shows where it's used, and clears it on delete", async () => {
    const client = await account(h, "proxy-assign");
    const other = await account(h, "proxy-assign-other");
    const proxy = await addProxy(client, {
      name: "Work proxy",
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
    });
    const foreign = await addProxy(other, {
      name: "Not yours",
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
    });
    const [personal] = profileListSchema.parse((await client.get("/profiles")).json()).profiles;
    if (!personal) throw new Error("no profile");

    const refused = await client.patch(`/profiles/${personal.id}`, { proxyId: foreign.id });
    expect(refused.statusCode).toBe(400);
    expect(h.errorOf(refused).details).toEqual([
      "proxyId: That proxy doesn’t exist any more. Choose another.",
    ]);

    const assigned = await client.patch(`/profiles/${personal.id}`, { proxyId: proxy.id });
    expect(assigned.statusCode).toBe(200);
    const [listed] = proxyListSchema.parse((await client.get("/proxies")).json()).proxies;
    expect(listed?.usedBy).toEqual([{ id: personal.id, name: "Personal" }]);

    expect((await client.delete(`/proxies/${proxy.id}`)).statusCode).toBe(204);
    const [after] = profileListSchema.parse((await client.get("/profiles")).json()).profiles;
    expect(after?.proxyId).toBeNull();
    expect((await other.delete(`/proxies/${proxy.id}`)).statusCode).toBe(404);
  });

  it("records changes and includes proxies, without credentials, in the data download", async () => {
    const email = h.uniqueEmail("proxy-export");
    const client = h.browser();
    await h.signUp(client, email, "violet-harbor-lantern");
    const proxy = await addProxy(client, {
      name: "Exported",
      protocol: "socks5",
      host: "proxy.example.com",
      port: 1080,
      credentials: AUTH,
    });
    await client.patch(`/proxies/${proxy.id}`, { rotation: "rotating" });
    const raw = (await client.get("/account/export")).body;
    expect(raw).not.toContain(AUTH.password);
    expect(raw).not.toContain(AUTH.username);
    expect(accountExportSchema.parse(JSON.parse(raw)).proxies).toEqual([
      expect.objectContaining({ name: "Exported", rotation: "rotating", hasCredentials: true }),
    ]);
    expect(await h.eventTypes(email)).toEqual(
      expect.arrayContaining(["proxy.created", "proxy.updated"]),
    );
  });
});

describe("the echo endpoint", () => {
  it("answers with the caller's address, as plain text", async () => {
    const response = await h.browser(undefined, "198.51.100.200").get("/network/echo");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/plain/);
    expect(response.body).toBe("198.51.100.200");
  });
});
