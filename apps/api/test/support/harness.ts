import { randomUUID } from "node:crypto";
import { apiErrorSchema, sessionCookieName } from "@brawzer/contracts";
import { createDatabase, type DatabaseHandle } from "@brawzer/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { Redis } from "ioredis";
import { pino } from "pino";
import { createApp } from "../../src/app.factory.js";
import { type AppConfig, loadLocalEnvFile, parseConfig } from "../../src/config/env.js";

export const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
export const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";

export interface TestBrowser {
  get(path: string, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
  post(
    path: string,
    payload?: object,
    headers?: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
  patch(
    path: string,
    payload?: object,
    headers?: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
  put(
    path: string,
    payload?: object,
    headers?: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
  delete(path: string, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
  /** A multipart upload of one file, as a browser form would send it. */
  upload(
    path: string,
    file: { name: string; content: Buffer; type?: string },
  ): Promise<LightMyRequestResponse>;
  /** A request with a raw body and explicit headers. */
  raw(
    method: "POST" | "PUT",
    path: string,
    body: Buffer,
    headers: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
  session: string | undefined;
}

/**
 * Boots the real API against the local services (`pnpm infra:up`) with
 * production rate limits, and offers test "browsers" with their own address
 * and cookie jar. `ipPrefix` keeps rate-limit counters apart between files.
 */
export async function createHarness(options: { ipPrefix: string; env?: NodeJS.ProcessEnv }) {
  loadLocalEnvFile();
  const config: AppConfig = parseConfig({
    ...process.env,
    RATE_LIMIT_SCALE: "1",
    EMAIL_TRANSPORT: "mailpit",
    ...options.env,
  });
  const cookieName = sessionCookieName(config.secureCookies);
  const origin = config.webOrigin;

  const redis = new Redis(config.redisUrl);
  const keys = await redis.keys("rl:*");
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();

  const database: DatabaseHandle = createDatabase({
    url: config.databaseUrl,
    applicationName: "brawzer-api-tests",
  });
  const app: NestFastifyApplication = await createApp(config, {
    logger: pino({ level: "silent" }),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  let clients = 0;

  /** `ip` puts the browser on another network than the file's usual one. */
  function browser(userAgent = WINDOWS_CHROME, ip?: string): TestBrowser {
    clients += 1;
    const address = ip ?? `${options.ipPrefix}.${String(clients)}`;
    let session: string | undefined;

    async function send(
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
      path: string,
      payload?: object | Buffer,
      headers: Record<string, string> = {},
    ): Promise<LightMyRequestResponse> {
      const response = await app.inject({
        method,
        url: `/api/v1${path}`,
        remoteAddress: address,
        headers: {
          ...(method === "GET" ? {} : { origin }),
          ...(session ? { cookie: `${cookieName}=${session}` } : {}),
          "user-agent": userAgent,
          ...headers,
        },
        ...(payload ? { payload } : {}),
      });
      const cookie = response.cookies.find((entry) => entry.name === cookieName);
      if (cookie) session = cookie.value === "" || cookie.maxAge === 0 ? undefined : cookie.value;
      return response;
    }

    return {
      get: (path, headers) => send("GET", path, undefined, headers),
      post: (path, payload, headers) => send("POST", path, payload, headers),
      patch: (path, payload, headers) => send("PATCH", path, payload, headers),
      put: (path, payload, headers) => send("PUT", path, payload, headers),
      delete: (path, headers) => send("DELETE", path, undefined, headers),
      upload: (path, file) => {
        const boundary = `----brawzer${randomUUID().replaceAll("-", "")}`;
        const head = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name.replaceAll('"', "%22")}"\r\nContent-Type: ${file.type ?? "application/octet-stream"}\r\n\r\n`,
        );
        const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
        return send("POST", path, Buffer.concat([head, file.content, tail]), {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        });
      },
      raw: (method, path, body, headers) => send(method, path, body, headers),
      get session() {
        return session;
      },
      set session(value: string | undefined) {
        session = value;
      },
    };
  }

  async function emailsTo(address: string, subject: string) {
    const query = encodeURIComponent(`to:"${address}"`);
    const response = await fetch(`${config.email.mailpitApiUrl}/api/v1/search?query=${query}`);
    const body = (await response.json()) as { messages: { ID: string; Subject: string }[] };
    return body.messages.filter((message) => message.Subject.includes(subject));
  }

  /** Waits for the `count`-th matching email (newest first) and returns its text. */
  async function waitForEmail(address: string, subject: string, count = 1): Promise<string> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const messages = await emailsTo(address, subject);
      const newest = messages[0];
      if (newest && messages.length >= count) {
        const response = await fetch(`${config.email.mailpitApiUrl}/api/v1/message/${newest.ID}`);
        return ((await response.json()) as { Text: string }).Text;
      }
      if (Date.now() > deadline)
        throw new Error(`No "${subject}" email (#${String(count)}) for ${address}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  function tokenIn(text: string): string {
    const match = /#token=([A-Za-z0-9_-]{43})/.exec(text);
    if (!match?.[1]) throw new Error("No token in email");
    return match[1];
  }

  /** Registers and confirms an account; the browser ends up signed in. */
  async function signUp(client: TestBrowser, email: string, password = "violet-harbor-lantern") {
    const registered = await client.post("/auth/register", { email, password });
    if (registered.statusCode !== 202) throw new Error(`register: ${registered.body}`);
    const token = tokenIn(await waitForEmail(email, "Confirm your email"));
    const verified = await client.post("/auth/verify-email", { token, password });
    if (verified.statusCode !== 200) throw new Error(`verify: ${verified.body}`);
  }

  async function signIn(
    client: TestBrowser,
    email: string,
    password = "violet-harbor-lantern",
    keepSignedIn = false,
  ) {
    const response = await client.post("/auth/login", { email, password, keepSignedIn });
    if (response.statusCode !== 200) throw new Error(`login: ${response.body}`);
    return response;
  }

  async function eventTypes(email: string): Promise<string[]> {
    const result = await database.pool.query<{ type: string }>(
      `select e.type from security_events e join users u on u.id = e.user_id
       where u.email = $1 order by e.occurred_at, e.id`,
      [email],
    );
    return result.rows.map((row) => row.type);
  }

  /** Makes the account's sessions look like their identity was confirmed 11 minutes ago. */
  async function expireConfirmation(email: string): Promise<void> {
    await database.pool.query(
      `update auth_sessions set reauthenticated_at = now() - interval '11 minutes'
       where user_id = (select id from users where email = $1)`,
      [email],
    );
  }

  return {
    app,
    config,
    database,
    origin,
    browser,
    waitForEmail,
    emailsTo,
    tokenIn,
    signUp,
    signIn,
    eventTypes,
    expireConfirmation,
    uniqueEmail: (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@example.com`,
    errorOf: (response: LightMyRequestResponse) => apiErrorSchema.parse(response.json()).error,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
