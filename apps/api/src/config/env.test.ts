import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, findInWorkspace, parseConfig } from "./env.js";

const minimal = {
  DATABASE_URL: "postgres://brawzer:local@127.0.0.1:5433/brawzer",
  REDIS_URL: "redis://127.0.0.1:6380",
  ENCRYPTION_KEYS: "test-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};

const production = {
  METRICS_TOKEN: "a-scraper-token-for-tests",
  ...minimal,
  NODE_ENV: "production",
  WEB_ORIGIN: "https://brawzer.example",
  EMAIL_TRANSPORT: "resend",
  RESEND_API_KEY: "re_not_a_real_key",
  KEY_PROVIDER: "vault",
  VAULT_ADDR: "https://vault.internal:8200",
  VAULT_TOKEN: "not-a-real-token",
  PROXY_TEST_URL: "https://echo.brawzer.example/ip",
  BROWSER_STREAM_URL: "wss://brawzer.example",
};

function issuesOf(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    parseConfig(env, "1.2.3");
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected parseConfig to throw");
}

describe("parseConfig", () => {
  it("applies local development defaults", () => {
    const config = parseConfig(minimal, "1.2.3");
    expect(config).toMatchObject({
      env: "development",
      isProduction: false,
      version: "1.2.3",
      apiHost: "127.0.0.1",
      apiPort: 4100,
      webOrigin: "http://localhost:3100",
      logLevel: "info",
      logFormat: "json",
      apiDocsEnabled: true,
      trustProxy: false,
    });
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(parseConfig(minimal, "1.2.3"))).toBe(true);
  });

  it("turns API docs off in production unless explicitly enabled", () => {
    expect(parseConfig(production, "1").apiDocsEnabled).toBe(false);
    expect(parseConfig({ ...production, API_DOCS_ENABLED: "true" }, "1").apiDocsEnabled).toBe(true);
  });

  it("appends a short build SHA to the version", () => {
    const config = parseConfig({ ...minimal, BUILD_SHA: "0123456789abcdef0123" }, "1.2.3");
    expect(config.version).toBe("1.2.3+0123456789ab");
  });

  it("reports every missing required variable", () => {
    expect(issuesOf({})).toEqual(["DATABASE_URL: is required", "REDIS_URL: is required"]);
  });

  it("reads local encryption keys, the first one being current", () => {
    const config = parseConfig(
      { ...minimal, ENCRYPTION_KEYS: `new-2:${"B".repeat(43)}=, old-1:${"A".repeat(43)}=` },
      "1",
    );
    expect(config.encryption.provider).toBe("local");
    if (config.encryption.provider !== "local") return;
    expect(config.encryption.keys.map((key) => key.id)).toEqual(["new-2", "old-1"]);
  });

  it("rejects malformed keys without echoing them", () => {
    const issues = issuesOf({ ...minimal, ENCRYPTION_KEYS: "dev:c2hvcnQ=" });
    expect(issues).toEqual(["ENCRYPTION_KEYS: each entry must be id:base64 with a 256-bit key"]);
    expect(issues.join()).not.toContain("c2hvcnQ");
    expect(issuesOf({ ...minimal, ENCRYPTION_KEYS: undefined })).toEqual([
      "ENCRYPTION_KEYS: is required when KEY_PROVIDER is local",
    ]);
  });

  it("requires a key management service in production", () => {
    expect(
      issuesOf({ ...production, KEY_PROVIDER: "local", ENCRYPTION_KEYS: minimal.ENCRYPTION_KEYS }),
    ).toEqual(["KEY_PROVIDER: must be a key management service (vault) in production"]);
    expect(issuesOf({ ...production, VAULT_TOKEN: undefined })).toEqual([
      "VAULT_TOKEN: is required when KEY_PROVIDER is vault",
    ]);
    expect(parseConfig(production, "1").encryption).toEqual({
      provider: "vault",
      vault: {
        address: "https://vault.internal:8200",
        token: "not-a-real-token",
        mount: "transit",
        keyName: "brawzer",
      },
    });
  });

  it("rejects URLs with the wrong protocol", () => {
    expect(issuesOf({ ...minimal, DATABASE_URL: "mysql://user:pw@db/app" })).toEqual([
      "DATABASE_URL: must be a postgres:// URL",
    ]);
  });

  it("never echoes the offending value, which may contain a password", () => {
    const secret = "correct-horse-battery-staple";
    const issues = issuesOf({ ...minimal, DATABASE_URL: `mysql://admin:${secret}@db/app` });
    expect(issues.join("\n")).not.toContain(secret);
  });

  it("rejects an out-of-range port", () => {
    expect(issuesOf({ ...minimal, API_PORT: "70000" })[0]).toMatch(/^API_PORT:/);
  });

  it("parses boolean flags strictly", () => {
    expect(parseConfig({ ...minimal, TRUST_PROXY: "true" }, "1").trustProxy).toBe(true);
    expect(issuesOf({ ...minimal, TRUST_PROXY: "maybe" })[0]).toMatch(/^TRUST_PROXY:/);
  });

  it("accepts a list of trusted proxy addresses", () => {
    expect(
      parseConfig({ ...minimal, TRUST_PROXY: "loopback, 10.0.0.0/8, 2001:db8::1" }, "1").trustProxy,
    ).toEqual(["loopback", "10.0.0.0/8", "2001:db8::1"]);
    expect(issuesOf({ ...minimal, TRUST_PROXY: "10.0.0.0/33" })[0]).toMatch(/^TRUST_PROXY:/);
    expect(issuesOf({ ...minimal, TRUST_PROXY: "proxy.internal" })[0]).toMatch(/^TRUST_PROXY:/);
  });

  it("allows the web origin plus any extra origins for state-changing requests", () => {
    expect(parseConfig(minimal, "1").allowedOrigins).toEqual(["http://localhost:3100"]);
    const config = parseConfig(
      { ...minimal, ALLOWED_ORIGINS: "http://127.0.0.1:3100, http://localhost:3100" },
      "1",
    );
    expect(config.allowedOrigins).toEqual(["http://localhost:3100", "http://127.0.0.1:3100"]);
    expect(issuesOf({ ...minimal, ALLOWED_ORIGINS: "http://localhost:3100/app" })).toEqual([
      "ALLOWED_ORIGINS: each entry must be an http(s) origin",
    ]);
  });

  it("uses Secure __Host- cookies whenever the site is served over HTTPS", () => {
    expect(parseConfig(minimal, "1").secureCookies).toBe(false);
    expect(
      parseConfig({ ...minimal, WEB_ORIGIN: "https://staging.brawzer.example" }, "1").secureCookies,
    ).toBe(true);
  });

  it("relaxes rate limits outside production only", () => {
    expect(parseConfig(minimal, "1").rateLimitScale).toBe(20);
    expect(parseConfig({ ...minimal, RATE_LIMIT_SCALE: "1" }, "1").rateLimitScale).toBe(1);
    expect(parseConfig({ ...production, RATE_LIMIT_SCALE: "50" }, "1").rateLimitScale).toBe(1);
  });

  it("requires HTTPS and a real email provider in production", () => {
    expect(issuesOf({ ...minimal, NODE_ENV: "production" })).toEqual([
      "WEB_ORIGIN: must use https in production",
      "EMAIL_TRANSPORT: must be resend in production",
      "KEY_PROVIDER: must be a key management service (vault) in production",
      "PROXY_TEST_URL: must be set to an https URL in production",
      "METRICS_TOKEN: is required in production (16+ characters)",
      "BROWSER_STREAM_URL: must be set to a wss:// URL in production",
    ]);
    expect(issuesOf({ ...production, RESEND_API_KEY: undefined })).toEqual([
      "RESEND_API_KEY: is required when EMAIL_TRANSPORT is resend",
    ]);
  });

  it("checks breached passwords in production by default, never silently elsewhere", () => {
    expect(parseConfig(minimal, "1").breachedPasswordCheck).toBe(false);
    expect(parseConfig(production, "1").breachedPasswordCheck).toBe(true);
    expect(
      parseConfig({ ...production, BREACHED_PASSWORD_CHECK: "false" }, "1").breachedPasswordCheck,
    ).toBe(false);
    expect(
      parseConfig({ ...minimal, BREACHED_PASSWORD_CHECK: "true" }, "1").breachedPasswordCheck,
    ).toBe(true);
  });

  it("keeps the security history for a year unless configured, and never less than 30 days", () => {
    expect(parseConfig(minimal, "1").securityHistoryRetentionDays).toBe(365);
    expect(
      parseConfig({ ...minimal, SECURITY_HISTORY_RETENTION_DAYS: "90" }, "1")
        .securityHistoryRetentionDays,
    ).toBe(90);
    expect(issuesOf({ ...minimal, SECURITY_HISTORY_RETENTION_DAYS: "7" })[0]).toMatch(
      /^SECURITY_HISTORY_RETENTION_DAYS:/,
    );
  });

  it("points proxy tests at this API's echo by default, and never relaxes them in production", () => {
    expect(parseConfig(minimal, "1").proxyTests).toEqual({
      url: "http://127.0.0.1:4100/api/v1/network/echo",
      allowPrivate: false,
      runner: "egress",
    });
    expect(parseConfig({ ...minimal, PROXY_TEST_RUNNER: "inline" }, "1").proxyTests.runner).toBe(
      "inline",
    );
    expect(issuesOf({ ...production, PROXY_TEST_RUNNER: "inline" })).toEqual([
      "PROXY_TEST_RUNNER: must be egress in production",
    ]);
    expect(issuesOf({ ...production, EGRESS_LOOPBACK_HOST: "host.docker.internal" })).toEqual([
      "EGRESS_LOOPBACK_HOST: must not be set in production",
    ]);
    expect(
      parseConfig({ ...minimal, PROXY_TEST_ALLOW_PRIVATE: "true" }, "1").proxyTests.allowPrivate,
    ).toBe(true);
    expect(issuesOf({ ...production, PROXY_TEST_ALLOW_PRIVATE: "true" })).toEqual([
      "PROXY_TEST_ALLOW_PRIVATE: must not be enabled in production",
    ]);
    expect(issuesOf({ ...production, PROXY_TEST_URL: "http://echo.brawzer.example/ip" })).toEqual([
      "PROXY_TEST_URL: must be set to an https URL in production",
    ]);
  });

  it("reaches the engine over a socket locally and over mutual TLS in production", () => {
    const local = parseConfig(minimal, "1").browser;
    expect(local.docker.kind).toBe("socket");
    expect(local.agentBind).toBe("127.0.0.1");
    expect(local.agentHost).toBe("127.0.0.1");
    expect(local.containerRuntime).toBeNull();
    expect(local.maxLiveSessions).toBe(200);

    const remote = parseConfig(
      {
        ...minimal,
        DOCKER_HOST: "tcp://runtime.internal:2376",
        BROWSER_CONTAINER_RUNTIME: "runsc",
      },
      "1",
    ).browser;
    expect(remote.docker).toEqual({ kind: "tcp", host: "runtime.internal", port: 2376, tls: null });
    expect(remote.agentBind).toBe("0.0.0.0");
    expect(remote.agentHost).toBe("runtime.internal");
    expect(remote.containerRuntime).toBe("runsc");

    // Several runtime hosts, the first one primary; names unique; TLS in production.
    const hosts = parseConfig(
      {
        ...minimal,
        RUNTIME_HOSTS: JSON.stringify([
          { name: "rt-1", docker: "tcp://rt1.internal:2376", capacity: 3 },
          { name: "rt-2", docker: "tcp://rt2.internal:2376", agentHost: "rt2.lan", capacity: 2 },
        ]),
      },
      "1",
    ).browser;
    expect(hosts.hosts.map((host) => [host.name, host.agentHost, host.capacity])).toEqual([
      ["rt-1", "rt1.internal", 3],
      ["rt-2", "rt2.lan", 2],
    ]);
    expect(hosts.docker).toEqual({ kind: "tcp", host: "rt1.internal", port: 2376, tls: null });
    expect(hosts.agentHost).toBe("rt1.internal");
    expect(
      issuesOf({
        ...minimal,
        RUNTIME_HOSTS: JSON.stringify([
          { name: "a", docker: "/tmp/d.sock", capacity: 1 },
          { name: "a", docker: "/tmp/e.sock", capacity: 1 },
        ]),
      }),
    ).toEqual(['RUNTIME_HOSTS: "a" is listed twice']);
    expect(issuesOf({ ...minimal, RUNTIME_HOSTS: "nope" })).toEqual([
      "RUNTIME_HOSTS: must be a JSON array of hosts",
    ]);
    expect(
      issuesOf({
        ...production,
        RUNTIME_HOSTS: JSON.stringify([{ name: "rt-1", docker: "tcp://rt1:2376", capacity: 1 }]),
      }),
    ).toContain('RUNTIME_HOSTS: "rt-1" needs mutual TLS in production');
    expect(parseConfig(minimal, "1").browser.hosts.map((host) => host.name)).toEqual(["local"]);

    expect(issuesOf({ ...production, DOCKER_HOST: "tcp://runtime.internal:2376" })).toEqual([
      "DOCKER_TLS_CA, DOCKER_TLS_CERT, DOCKER_TLS_KEY: a TCP engine needs mutual TLS in production",
    ]);
    expect(issuesOf({ ...minimal, DOCKER_HOST: "tcp://x", DOCKER_TLS_CA: "/nope" })).toEqual([
      "DOCKER_TLS_CA, DOCKER_TLS_CERT and DOCKER_TLS_KEY must be set together",
    ]);
    expect(
      issuesOf({
        ...minimal,
        DOCKER_HOST: "tcp://x",
        DOCKER_TLS_CA: "/nope",
        DOCKER_TLS_CERT: "/nope",
        DOCKER_TLS_KEY: "/nope",
      }),
    ).toEqual(["DOCKER_TLS_CA: can't read /nope"]);
  });

  it("lets tests lower Drive's per-file limit, but never production", () => {
    expect(parseConfig(minimal, "1").drive.maxFileBytes).toBe(100 * 1024 * 1024);
    expect(parseConfig({ ...minimal, DRIVE_MAX_FILE_BYTES: "4096" }, "1").drive.maxFileBytes).toBe(
      4096,
    );
    expect(issuesOf({ ...production, DRIVE_MAX_FILE_BYTES: "4096" })).toEqual([
      "DRIVE_MAX_FILE_BYTES: must not be set in production",
    ]);
  });

  it("configures the cloud browser runtime, with development-only knobs refused in production", () => {
    const config = parseConfig(minimal, "1");
    expect(config.browser.image).toBe("brawzer-runtime:dev");
    expect(config.browser.streamUrl).toBe("ws://127.0.0.1:4100");
    expect(config.browser.testSite).toBe(false);
    expect(
      parseConfig(
        { ...minimal, BROWSER_STREAM_URL: "ws://localhost:4100/", BROWSER_TEST_SITE: "true" },
        "1",
      ).browser,
    ).toMatchObject({ streamUrl: "ws://localhost:4100", testSite: true });
    expect(
      parseConfig({ ...minimal, DOCKER_HOST: "unix:///tmp/d.sock" }, "1").browser.dockerSocket,
    ).toBe("/tmp/d.sock");
    expect(issuesOf({ ...production, BROWSER_TEST_SITE: "true" })).toEqual([
      "BROWSER_TEST_SITE: must not be enabled in production",
    ]);
    expect(issuesOf({ ...production, BROWSER_STREAM_URL: "ws://api.example/" })).toEqual([
      "BROWSER_STREAM_URL: must be set to a wss:// URL in production",
    ]);
  });

  it("keeps every protection on in a complete production configuration", () => {
    const config = parseConfig(production, "1");
    expect(config).toMatchObject({
      isProduction: true,
      secureCookies: true,
      apiDocsEnabled: false,
      rateLimitScale: 1,
      breachedPasswordCheck: true,
      trustProxy: false,
      allowedOrigins: ["https://brawzer.example"],
      proxyTests: { url: "https://echo.brawzer.example/ip", allowPrivate: false },
      webauthn: { rpId: "brawzer.example", origins: ["https://brawzer.example"] },
      email: { transport: "resend" },
    });
    expect(config.encryption.provider).toBe("vault");
    // Development conveniences can't be switched back on.
    expect(parseConfig({ ...production, RATE_LIMIT_SCALE: "50" }, "1").rateLimitScale).toBe(1);
    expect(issuesOf({ ...production, KEY_PROVIDER: "local" })).toContain(
      "KEY_PROVIDER: must be a key management service (vault) in production",
    );
  });

  it("configures Drive's store and scanner, with production rules", () => {
    const local = parseConfig(minimal, "1");
    expect(local.storage).toEqual({
      endpoint: undefined,
      region: "us-east-1",
      bucket: "brawzer-drive",
      credentials: undefined,
      forcePathStyle: false,
      createBucket: true,
    });
    expect(local.scanner).toEqual({ host: "127.0.0.1", port: 3310 });
    const selfHosted = parseConfig(
      {
        ...minimal,
        STORAGE_ENDPOINT: "http://127.0.0.1:9100",
        STORAGE_ACCESS_KEY_ID: "key",
        STORAGE_SECRET_ACCESS_KEY: "secret",
      },
      "1",
    );
    expect(selfHosted.storage.forcePathStyle).toBe(true);
    expect(selfHosted.storage.credentials).toEqual({
      accessKeyId: "key",
      secretAccessKey: "secret",
    });
    expect(parseConfig(production, "1").storage.createBucket).toBe(false);
    expect(issuesOf({ ...production, STORAGE_ENDPOINT: "http://store.internal:9000" })).toEqual([
      "STORAGE_ENDPOINT: must use https in production",
    ]);
    expect(issuesOf({ ...minimal, STORAGE_ACCESS_KEY_ID: "key" })).toEqual([
      "STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY: set both or neither",
    ]);
    expect(issuesOf({ ...minimal, STORAGE_BUCKET: "Bad_Bucket" })[0]).toMatch(/^STORAGE_BUCKET:/);
  });

  it("delivers email to Mailpit by default in development", () => {
    expect(parseConfig(minimal, "1").email).toEqual({
      transport: "mailpit",
      from: "Brawzer <no-reply@brawzer.localhost>",
      mailpitApiUrl: "http://127.0.0.1:8125",
      resendApiKey: undefined,
    });
  });
});

describe("findInWorkspace", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function workspace(): { root: string; app: string } {
    const root = mkdtempSync(path.join(tmpdir(), "brawzer-ws-"));
    roots.push(root);
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const app = path.join(root, "apps", "api");
    mkdirSync(app, { recursive: true });
    return { root, app };
  }

  it("finds the workspace-root .env from inside an app", () => {
    const { root, app } = workspace();
    writeFileSync(path.join(root, ".env"), "X=1\n");
    expect(findInWorkspace(app, ".env")).toBe(path.join(root, ".env"));
  });

  it("stops at the workspace root instead of reading files above it", () => {
    const { app } = workspace();
    expect(findInWorkspace(app, ".env")).toBeUndefined();
  });
});
