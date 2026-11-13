import { randomUUID } from "node:crypto";
import {
  apiErrorSchema,
  currentSessionResponseSchema,
  deviceSessionListSchema,
  messageResponseSchema,
  securityEventPageSchema,
  sessionCookieName,
} from "@brawzer/contracts";
import { createDatabase, type DatabaseHandle } from "@brawzer/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Redis } from "ioredis";
import type { LightMyRequestResponse } from "fastify";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.factory.js";
import { type AppConfig, loadLocalEnvFile, parseConfig } from "../src/config/env.js";

// Requires the local services: `pnpm infra:up`. Rate limits run at production
// values (scale 1); each test uses its own client address and email address.
loadLocalEnvFile();
const config: AppConfig = parseConfig({
  ...process.env,
  RATE_LIMIT_SCALE: "1",
  EMAIL_TRANSPORT: "mailpit",
});
const COOKIE = sessionCookieName(config.secureCookies);
const ORIGIN = config.webOrigin;

let app: NestFastifyApplication;
let database: DatabaseHandle;

beforeAll(async () => {
  const redis = new Redis(config.redisUrl);
  const keys = await redis.keys("rl:*");
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();

  database = createDatabase({ url: config.databaseUrl, applicationName: "brawzer-api-tests" });
  app = await createApp(config, { logger: pino({ level: "silent" }) });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

let clientCount = 0;

const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";

/** A browser: its own address, device and cookie jar. */
function browser(userAgent = WINDOWS_CHROME) {
  clientCount += 1;
  const ip = `198.51.100.${String(clientCount)}`;
  let session: string | undefined;

  async function send(
    method: "GET" | "POST" | "DELETE",
    path: string,
    payload?: object,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const response = await app.inject({
      method,
      url: `/api/v1${path}`,
      remoteAddress: ip,
      headers: {
        ...(method === "GET" ? {} : { origin: ORIGIN }),
        ...(session ? { cookie: `${COOKIE}=${session}` } : {}),
        "user-agent": userAgent,
        ...headers,
      },
      ...(payload ? { payload } : {}),
    });
    const cookie = response.cookies.find((entry) => entry.name === COOKIE);
    if (cookie) session = cookie.value === "" || cookie.maxAge === 0 ? undefined : cookie.value;
    return response;
  }

  return {
    get: (path: string, headers?: Record<string, string>) => send("GET", path, undefined, headers),
    post: (path: string, payload?: object, headers?: Record<string, string>) =>
      send("POST", path, payload, headers),
    delete: (path: string, headers?: Record<string, string>) =>
      send("DELETE", path, undefined, headers),
    get session() {
      return session;
    },
    set session(value: string | undefined) {
      session = value;
    },
  };
}

type Browser = ReturnType<typeof browser>;

const uniqueEmail = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@example.com`;

interface MailpitSummary {
  ID: string;
  Subject: string;
}

async function emailsTo(address: string, subject: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const response = await fetch(`${config.email.mailpitApiUrl}/api/v1/search?query=${query}`);
  const body = (await response.json()) as { messages: MailpitSummary[] };
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

async function allTokens(address: string, subject: string): Promise<string[]> {
  const messages = await emailsTo(address, subject);
  return Promise.all(
    messages.map(async (message) => {
      const response = await fetch(`${config.email.mailpitApiUrl}/api/v1/message/${message.ID}`);
      return tokenIn(((await response.json()) as { Text: string }).Text);
    }),
  );
}

function tokenIn(text: string): string {
  const match = /#token=([A-Za-z0-9_-]{43})/.exec(text);
  if (!match?.[1]) throw new Error("No token in email");
  return match[1];
}

const errorOf = (response: LightMyRequestResponse) => apiErrorSchema.parse(response.json()).error;

/** Registers and confirms an account; the browser ends up signed in. */
async function signUp(client: Browser, email: string, password: string): Promise<void> {
  expect(
    (await client.post("/auth/register", { name: "Ana Silva", email, password })).statusCode,
  ).toBe(202);
  const token = tokenIn(await waitForEmail(email, "Confirm your email"));
  const response = await client.post("/auth/verify-email", { token, password });
  expect(response.statusCode).toBe(200);
}

async function eventTypes(email: string): Promise<string[]> {
  const result = await database.pool.query<{ type: string }>(
    `select e.type from security_events e join users u on u.id = e.user_id
     where u.email = $1 order by e.occurred_at, e.id`,
    [email],
  );
  return result.rows.map((row) => row.type);
}

// ── Sign-up ──────────────────────────────────────────────────────────────────

describe("sign-up and email confirmation", () => {
  it("creates the account only when the link opener enters the chosen password", async () => {
    const client = browser();
    const email = uniqueEmail("signup");
    const password = "violet-harbor-lantern";

    const registered = await client.post("/auth/register", {
      name: "Ana Silva",
      email: ` ${email.toUpperCase()} `,
      password,
    });
    expect(registered.statusCode).toBe(202);
    expect(messageResponseSchema.parse(registered.json()).message).toMatch(/check your email/i);
    expect(client.session).toBeUndefined();

    const text = await waitForEmail(email, "Confirm your email");
    expect(text).toContain(`${ORIGIN}/verify-email#token=`);
    const token = tokenIn(text);

    const wrong = await client.post("/auth/verify-email", {
      token,
      password: "not-the-same-password",
    });
    expect(wrong.statusCode).toBe(401);
    expect(errorOf(wrong).code).toBe("invalid_credentials");
    expect(client.session).toBeUndefined();

    const verified = await client.post("/auth/verify-email", { token, password });
    expect(verified.statusCode).toBe(200);
    const body = currentSessionResponseSchema.parse(verified.json());
    expect(body.account).toMatchObject({ email, emailVerified: true });
    expect(body.session).toMatchObject({ persistent: false, idleTimeoutMinutes: 30 });
    expect(client.session).toBeDefined();

    const reused = await client.post("/auth/verify-email", { token, password });
    expect(reused.statusCode).toBe(400);
    expect(errorOf(reused).code).toBe("token_invalid");

    expect(await eventTypes(email)).toEqual([
      "account.created",
      "email.verified",
      "sign_in.succeeded",
    ]);
  });

  it("gives the same answer for new, unconfirmed and existing addresses", async () => {
    const fresh = uniqueEmail("same-answer-new");
    const confirmed = uniqueEmail("same-answer-existing");
    await signUp(browser(), confirmed, "violet-harbor-lantern");

    const client = browser();
    const responses = [
      await client.post("/auth/register", {
        name: "Ana Silva",
        email: fresh,
        password: "amber-river-compass",
      }),
      await client.post("/auth/register", {
        name: "Ana Silva",
        email: fresh,
        password: "amber-river-compass",
      }),
      await client.post("/auth/register", {
        name: "Ana Silva",
        email: confirmed,
        password: "amber-river-compass",
      }),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual(responses[0]?.json());
      expect(response.cookies).toEqual([]);
    }

    // The owner of the existing account is told, by email only.
    const notice = await waitForEmail(confirmed, "tried to create");
    expect(notice).toContain(`${ORIGIN}/sign-in`);
  });

  it("defeats account pre-hijacking", async () => {
    const victimEmail = uniqueEmail("prehijack");
    const attacker = browser();
    const victim = browser();

    await attacker.post("/auth/register", {
      name: "Ana Silva",
      email: victimEmail,
      password: "attacker-chosen-secret",
    });
    await waitForEmail(victimEmail, "Confirm your email", 1);
    await victim.post("/auth/register", {
      name: "Ana Silva",
      email: victimEmail,
      password: "victims-own-passphrase",
    });
    await waitForEmail(victimEmail, "Confirm your email", 2);
    const [victimLink, attackerLink] = await allTokens(victimEmail, "Confirm your email");
    if (!victimLink || !attackerLink) throw new Error("expected two links");

    // The attacker's link is bound to the attacker's password, not the victim's.
    expect(
      (
        await victim.post("/auth/verify-email", {
          token: attackerLink,
          password: "victims-own-passphrase",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await victim.post("/auth/verify-email", {
          token: victimLink,
          password: "victims-own-passphrase",
        })
      ).statusCode,
    ).toBe(200);

    // Afterwards the attacker's link and password are worthless.
    const late = await attacker.post("/auth/verify-email", {
      token: attackerLink,
      password: "attacker-chosen-secret",
    });
    expect(errorOf(late).code).toBe("token_invalid");
    const signIn = await attacker.post("/auth/login", {
      email: victimEmail,
      password: "attacker-chosen-secret",
    });
    expect(signIn.statusCode).toBe(401);
  });

  it("rejects easily guessed passwords with a field-level message", async () => {
    const response = await browser().post("/auth/register", {
      name: "Ana Silva",
      email: uniqueEmail("weak"),
      password: "password1234",
    });
    expect(response.statusCode).toBe(400);
    const error = errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(error.details?.[0]).toMatch(/^password: /);
  });

  it("validates input with the shared contract", async () => {
    const response = await browser().post("/auth/register", {
      name: "Ana Silva",
      email: "nope",
      password: "short",
    });
    expect(errorOf(response).details).toEqual([
      "email: Enter a valid email address, like name@example.com.",
      "password: Use at least 10 characters.",
    ]);
  });
});

// ── Sign-in ──────────────────────────────────────────────────────────────────

describe("sign-in", () => {
  it("uses one answer for unknown addresses and wrong passwords", async () => {
    const email = uniqueEmail("signin-same");
    await signUp(browser(), email, "violet-harbor-lantern");
    const client = browser();

    const unknown = await client.post("/auth/login", {
      email: uniqueEmail("nobody"),
      password: "violet-harbor-lantern",
    });
    const wrong = await client.post("/auth/login", { email, password: "violet-harbor-lantern!" });
    for (const response of [unknown, wrong]) {
      expect(response.statusCode).toBe(401);
      expect(errorOf(response)).toMatchObject({
        code: "invalid_credentials",
        message: "Email or password is incorrect.",
      });
    }
  });

  it("sets a browser-session cookie by default and a 30-day cookie only on request", async () => {
    const email = uniqueEmail("cookie");
    await signUp(browser(), email, "violet-harbor-lantern");

    const shared = await browser().post("/auth/login", {
      email,
      password: "violet-harbor-lantern",
    });
    const sharedCookie = shared.cookies.find((cookie) => cookie.name === COOKIE);
    expect(sharedCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(sharedCookie?.maxAge).toBeUndefined();
    expect(sharedCookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const kept = await browser().post("/auth/login", {
      email,
      password: "violet-harbor-lantern",
      keepSignedIn: true,
    });
    const keptCookie = kept.cookies.find((cookie) => cookie.name === COOKIE);
    expect(keptCookie?.maxAge).toBeGreaterThan(29 * 24 * 60 * 60);
    expect(currentSessionResponseSchema.parse(kept.json()).session).toMatchObject({
      persistent: true,
      idleTimeoutMinutes: 14 * 24 * 60,
    });
  });

  it("never returns hashes or other internal fields", async () => {
    const email = uniqueEmail("no-leak");
    await signUp(browser(), email, "violet-harbor-lantern");
    const response = await browser().post("/auth/login", {
      email,
      password: "violet-harbor-lantern",
    });
    const raw = response.body;
    for (const field of [
      "passwordHash",
      "tokenHash",
      "argon2",
      "ipAddress",
      "userAgent",
      "previousTokenHash",
    ]) {
      expect(raw).not.toContain(field);
    }
  });

  it("sends a new confirmation link to someone who signs in before confirming", async () => {
    const email = uniqueEmail("unconfirmed");
    const client = browser();
    await client.post("/auth/register", {
      name: "Ana Silva",
      email,
      password: "violet-harbor-lantern",
    });
    await waitForEmail(email, "Confirm your email", 1);

    const wrong = await client.post("/auth/login", { email, password: "something-else-entirely" });
    expect(errorOf(wrong).code).toBe("invalid_credentials");

    const right = await client.post("/auth/login", { email, password: "violet-harbor-lantern" });
    expect(right.statusCode).toBe(403);
    expect(errorOf(right).code).toBe("email_not_verified");
    expect(client.session).toBeUndefined();

    const token = tokenIn(await waitForEmail(email, "Confirm your email", 2));
    expect(
      (await client.post("/auth/verify-email", { token, password: "violet-harbor-lantern" }))
        .statusCode,
    ).toBe(200);
  });

  it("locks an address for a while after repeated wrong passwords", async () => {
    const email = uniqueEmail("lockout");
    await signUp(browser(), email, "violet-harbor-lantern");

    // Spread over several addresses: the lock follows the account, not the network.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await browser().post("/auth/login", {
        email,
        password: `wrong-password-${String(attempt)}`,
      });
      expect(response.statusCode).toBe(401);
    }
    const locked = await browser().post("/auth/login", {
      email,
      password: "violet-harbor-lantern",
    });
    expect(locked.statusCode).toBe(429);
    expect(errorOf(locked).code).toBe("rate_limited");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    expect((await eventTypes(email)).filter((type) => type === "sign_in.failed")).toHaveLength(8);
  });
});

// ── Sessions ─────────────────────────────────────────────────────────────────

describe("sessions", () => {
  it("rotates the token on refresh and honours the old one briefly", async () => {
    const client = browser();
    await signUp(client, uniqueEmail("refresh"), "violet-harbor-lantern");
    const original = client.session;

    const refreshed = await client.post("/auth/refresh");
    expect(refreshed.statusCode).toBe(200);
    const rotated = client.session;
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(original);

    // A request that was already in flight with the old token still works,
    // and does not rotate a second time.
    const racing = browser();
    racing.session = original;
    expect((await racing.get("/auth/session")).statusCode).toBe(200);
    const raced = await racing.post("/auth/refresh");
    expect(raced.statusCode).toBe(200);
    expect(raced.cookies).toEqual([]);

    expect((await client.get("/auth/session")).statusCode).toBe(200);
  });

  it("ends a shared-computer session after 30 idle minutes", async () => {
    const client = browser();
    const email = uniqueEmail("idle");
    await signUp(client, email, "violet-harbor-lantern");
    await database.pool.query(
      `update auth_sessions set last_seen_at = now() - interval '31 minutes'
       where user_id = (select id from users where email = $1)`,
      [email],
    );

    const response = await client.get("/auth/session");
    expect(response.statusCode).toBe(401);
    expect(errorOf(response).message).toMatch(/session has ended/);
    const { rows } = await database.pool.query<{ revoked_reason: string }>(
      `select revoked_reason from auth_sessions where user_id = (select id from users where email = $1)`,
      [email],
    );
    expect(rows.map((row) => row.revoked_reason)).toEqual(["idle_timeout"]);
  });

  it("signs out: ends the session, clears the cookie and asks the browser to clear site data", async () => {
    const client = browser();
    const email = uniqueEmail("logout");
    await signUp(client, email, "violet-harbor-lantern");
    const token = client.session;

    const response = await client.post("/auth/logout");
    expect(response.statusCode).toBe(204);
    expect(response.headers["clear-site-data"]).toBe('"cache", "storage"');
    expect(client.session).toBeUndefined();

    const replay = browser();
    replay.session = token;
    expect((await replay.get("/auth/session")).statusCode).toBe(401);
    expect(await eventTypes(email)).toContain("sign_out");
  });

  it("rejects a forged cookie and tells the browser to drop it", async () => {
    const client = browser();
    client.session = "A".repeat(43);
    const response = await client.get("/auth/session");
    expect(response.statusCode).toBe(401);
    expect(response.cookies.find((cookie) => cookie.name === COOKIE)?.maxAge).toBe(0);
  });

  it("asks someone without a session to sign in", async () => {
    const response = await browser().get("/auth/session");
    expect(response.statusCode).toBe(401);
    expect(errorOf(response)).toMatchObject({
      code: "unauthorized",
      message: "Sign in to continue.",
    });
  });
});

// ── Password reset ───────────────────────────────────────────────────────────

describe("password reset", () => {
  it("gives the same answer whether or not the address has an account", async () => {
    const known = uniqueEmail("forgot-known");
    await signUp(browser(), known, "violet-harbor-lantern");
    const client = browser();
    const unknownResponse = await client.post("/auth/password/forgot", {
      email: uniqueEmail("forgot-unknown"),
    });
    const knownResponse = await client.post("/auth/password/forgot", { email: known });
    expect(unknownResponse.statusCode).toBe(202);
    expect(knownResponse.statusCode).toBe(202);
    expect(knownResponse.json()).toEqual(unknownResponse.json());
  });

  it("sets the new password, signs out every device and notifies the owner", async () => {
    const email = uniqueEmail("reset");
    const laptop = browser();
    const phone = browser();
    await signUp(laptop, email, "violet-harbor-lantern");
    await phone.post("/auth/login", { email, password: "violet-harbor-lantern" });
    expect((await phone.get("/auth/session")).statusCode).toBe(200);

    await browser().post("/auth/password/forgot", { email });
    const text = await waitForEmail(email, "Reset your Brawzer password");
    expect(text).toContain(`${ORIGIN}/reset-password#token=`);
    const token = tokenIn(text);

    const helper = browser();
    const weak = await helper.post("/auth/password/reset", { token, password: "password1234" });
    expect(errorOf(weak).code).toBe("validation_failed");

    const reset = await helper.post("/auth/password/reset", {
      token,
      password: "amber-river-compass",
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.cookies).toEqual([]);

    expect((await laptop.get("/auth/session")).statusCode).toBe(401);
    expect((await phone.get("/auth/session")).statusCode).toBe(401);
    expect(
      (await browser().post("/auth/login", { email, password: "violet-harbor-lantern" }))
        .statusCode,
    ).toBe(401);
    expect(
      (await browser().post("/auth/login", { email, password: "amber-river-compass" })).statusCode,
    ).toBe(200);

    const reused = await helper.post("/auth/password/reset", {
      token,
      password: "another-fine-passphrase",
    });
    expect(errorOf(reused).code).toBe("token_invalid");

    const notice = await waitForEmail(email, "password was changed");
    expect(notice).toContain("Chrome on Windows");
    expect(await eventTypes(email)).toEqual(
      expect.arrayContaining(["password.reset_requested", "password.reset", "sessions.revoked"]),
    );
  });
});

// ── Cross-site request forgery ───────────────────────────────────────────────

describe("cross-site request protection", () => {
  it("blocks state-changing requests that don't come from a Brawzer page", async () => {
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        remoteAddress: "198.51.100.250",
        headers,
        payload: { email: "a@example.com", password: "irrelevant-password" },
      });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe("forbidden");
      expect(response.headers["cache-control"]).toBe("no-store");
    }

    // A browser that omits Origin but labels the request same-origin is let through.
    const sameOrigin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      remoteAddress: "198.51.100.251",
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(sameOrigin.statusCode).toBe(204);
  });
});

// ── Signed-in devices ────────────────────────────────────────────────────────

async function signIn(client: Browser, email: string, password: string): Promise<void> {
  const response = await client.post("/auth/login", { email, password });
  expect(response.statusCode).toBe(200);
}

async function listSessions(client: Browser) {
  const response = await client.get("/auth/sessions");
  expect(response.statusCode).toBe(200);
  return deviceSessionListSchema.parse(response.json()).sessions;
}

describe("signed-in devices", () => {
  it("lists the account's devices, this one first, without internal fields", async () => {
    const email = uniqueEmail("devices");
    const laptop = browser();
    const phone = browser(IPHONE_SAFARI);
    await signUp(laptop, email, "violet-harbor-lantern");
    await signIn(phone, email, "violet-harbor-lantern");

    const sessions = await listSessions(laptop);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ current: true, device: "Chrome on Windows" });
    expect(sessions[1]).toMatchObject({ current: false, device: "Safari on iOS" });
    const raw = (await laptop.get("/auth/sessions")).body;
    for (const field of ["tokenHash", "previousTokenHash", "userId", "revokedReason"]) {
      expect(raw).not.toContain(field);
    }
  });

  it("signs out another device immediately", async () => {
    const email = uniqueEmail("end-one");
    const laptop = browser();
    const phone = browser(IPHONE_SAFARI);
    await signUp(laptop, email, "violet-harbor-lantern");
    await signIn(phone, email, "violet-harbor-lantern");
    const phoneSession = (await listSessions(laptop)).find((session) => !session.current);
    if (!phoneSession) throw new Error("expected the phone's session");

    expect((await laptop.delete(`/auth/sessions/${phoneSession.id}`)).statusCode).toBe(204);
    expect((await phone.get("/auth/session")).statusCode).toBe(401);
    expect(await listSessions(laptop)).toHaveLength(1);

    const again = await laptop.delete(`/auth/sessions/${phoneSession.id}`);
    expect(again.statusCode).toBe(404);
    expect(errorOf(again).code).toBe("not_found");
    expect(await eventTypes(email)).toContain("sessions.revoked");
  });

  it("refuses to end this device's own session or another account's", async () => {
    const mine = browser();
    const theirs = browser();
    await signUp(mine, uniqueEmail("own"), "violet-harbor-lantern");
    await signUp(theirs, uniqueEmail("other"), "violet-harbor-lantern");
    const [own] = await listSessions(mine);
    const [other] = await listSessions(theirs);
    if (!own || !other) throw new Error("expected sessions");

    expect(errorOf(await mine.delete(`/auth/sessions/${own.id}`)).code).toBe("bad_request");
    expect((await mine.delete(`/auth/sessions/${other.id}`)).statusCode).toBe(404);
    expect((await theirs.get("/auth/session")).statusCode).toBe(200);
    expect(errorOf(await mine.delete("/auth/sessions/not-a-session")).code).toBe(
      "validation_failed",
    );
  });

  it("signs out every other device at once", async () => {
    const email = uniqueEmail("end-others");
    const laptop = browser();
    const phone = browser(IPHONE_SAFARI);
    const library = browser();
    await signUp(laptop, email, "violet-harbor-lantern");
    await signIn(phone, email, "violet-harbor-lantern");
    await signIn(library, email, "violet-harbor-lantern");

    const response = await laptop.post("/auth/sessions/revoke-others");
    expect(response.json()).toEqual({ revoked: 2 });
    expect((await phone.get("/auth/session")).statusCode).toBe(401);
    expect((await library.get("/auth/session")).statusCode).toBe(401);
    expect((await laptop.get("/auth/session")).statusCode).toBe(200);
  });

  it("requires a session and a Brawzer origin", async () => {
    expect((await browser().get("/auth/sessions")).statusCode).toBe(401);
    const client = browser();
    await signUp(client, uniqueEmail("csrf-delete"), "violet-harbor-lantern");
    const [own] = await listSessions(client);
    const forged = await client.delete(`/auth/sessions/${own?.id ?? ""}`, {
      origin: "https://evil.example",
    });
    expect(forged.statusCode).toBe(403);
  });
});

// ── Changing the password ────────────────────────────────────────────────────

describe("changing the password", () => {
  it("needs the current password and refuses weak or unchanged new ones", async () => {
    const client = browser();
    await signUp(client, uniqueEmail("change-checks"), "violet-harbor-lantern");

    const wrong = await client.post("/auth/password/change", {
      currentPassword: "not-my-password",
      newPassword: "amber-river-compass",
    });
    expect(wrong.statusCode).toBe(400);
    expect(errorOf(wrong).details).toEqual(["currentPassword: That isn’t your current password."]);
    expect(client.session).toBeDefined();

    const same = await client.post("/auth/password/change", {
      currentPassword: "violet-harbor-lantern",
      newPassword: "violet-harbor-lantern",
    });
    expect(errorOf(same).details?.[0]).toMatch(/^newPassword: /);

    const weak = await client.post("/auth/password/change", {
      currentPassword: "violet-harbor-lantern",
      newPassword: "password1234",
    });
    expect(errorOf(weak).details?.[0]).toMatch(/^newPassword: .*too common/);
  });

  it("signs out the other devices, keeps this one with a new token, and tells the owner", async () => {
    const email = uniqueEmail("change");
    const laptop = browser();
    const phone = browser(IPHONE_SAFARI);
    await signUp(laptop, email, "violet-harbor-lantern");
    await signIn(phone, email, "violet-harbor-lantern");
    const before = laptop.session;

    const response = await laptop.post("/auth/password/change", {
      currentPassword: "violet-harbor-lantern",
      newPassword: "amber-river-compass",
    });
    expect(response.statusCode).toBe(200);
    expect(messageResponseSchema.parse(response.json()).message).toMatch(/1 other device/);
    expect(laptop.session).toBeDefined();
    expect(laptop.session).not.toBe(before);

    expect((await laptop.get("/auth/session")).statusCode).toBe(200);
    expect((await phone.get("/auth/session")).statusCode).toBe(401);
    expect(
      (await browser().post("/auth/login", { email, password: "violet-harbor-lantern" }))
        .statusCode,
    ).toBe(401);
    expect(
      (await browser().post("/auth/login", { email, password: "amber-river-compass" })).statusCode,
    ).toBe(200);

    const notice = await waitForEmail(email, "password was changed");
    expect(notice).toContain("every other device");
    expect(await eventTypes(email)).toEqual(
      expect.arrayContaining(["password.changed", "sessions.revoked"]),
    );
  });
});

// ── Security history ─────────────────────────────────────────────────────────

describe("security history", () => {
  it("pages through the account's own events, newest first", async () => {
    const email = uniqueEmail("history");
    const client = browser();
    await signUp(client, email, "violet-harbor-lantern");
    await browser().post("/auth/login", { email, password: "wrong-password-1" });
    await signIn(browser(IPHONE_SAFARI), email, "violet-harbor-lantern");
    // Someone else's activity must never appear.
    await signUp(browser(), uniqueEmail("history-other"), "violet-harbor-lantern");

    const first = securityEventPageSchema.parse(
      (await client.get("/security/events?limit=2")).json(),
    );
    // The phone is new to the account, so its sign-in is also flagged.
    expect(first.events.map((event) => event.type)).toEqual([
      "sign_in.new_device",
      "sign_in.succeeded",
    ]);
    expect(first.events[0]).toMatchObject({ device: "Safari on iOS" });
    expect(first.events[1]).toMatchObject({
      device: "Safari on iOS",
      details: { method: "password" },
    });
    expect(first.nextCursor).toBe(first.events[1]?.id);

    const second = securityEventPageSchema.parse(
      (await client.get(`/security/events?limit=10&before=${first.nextCursor ?? ""}`)).json(),
    );
    expect(second.events.map((event) => event.type)).toEqual([
      "sign_in.failed",
      "sign_in.succeeded",
      "email.verified",
      "account.created",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("validates the query and requires a session", async () => {
    const client = browser();
    await signUp(client, uniqueEmail("history-query"), "violet-harbor-lantern");
    expect(errorOf(await client.get("/security/events?limit=500")).code).toBe("validation_failed");
    expect(errorOf(await client.get("/security/events?before=nope")).code).toBe(
      "validation_failed",
    );
    expect((await browser().get("/security/events")).statusCode).toBe(401);
  });
});

describe("passive session checks", () => {
  it("report whether the session is valid without counting as activity", async () => {
    const email = uniqueEmail("passive");
    const client = browser();
    await signUp(client, email, "violet-harbor-lantern");
    const lastSeen = async () =>
      (
        await database.pool.query<{ last_seen_at: Date }>(
          `select last_seen_at from auth_sessions where user_id = (select id from users where email = $1)`,
          [email],
        )
      ).rows[0]?.last_seen_at.getTime();
    await database.pool.query(
      `update auth_sessions set last_seen_at = now() - interval '10 minutes'
       where user_id = (select id from users where email = $1)`,
      [email],
    );
    const before = await lastSeen();

    expect((await client.get("/auth/session/status")).statusCode).toBe(204);
    expect(await lastSeen()).toBe(before);

    expect((await client.get("/auth/session")).statusCode).toBe(200);
    expect(await lastSeen()).toBeGreaterThan(before ?? 0);

    const token = client.session;
    await client.post("/auth/logout");
    const replay = browser();
    replay.session = token;
    expect((await replay.get("/auth/session/status")).statusCode).toBe(401);
  });
});

describe("confirming it's you", () => {
  async function expireConfirmation(email: string): Promise<void> {
    await database.pool.query(
      `update auth_sessions set reauthenticated_at = now() - interval '11 minutes'
       where user_id = (select id from users where email = $1)`,
      [email],
    );
  }

  it("asks before signing devices out once the sign-in is more than 10 minutes old", async () => {
    const email = uniqueEmail("reauth");
    const laptop = browser();
    const phone = browser(IPHONE_SAFARI);
    await signUp(laptop, email, "violet-harbor-lantern");
    await signIn(phone, email, "violet-harbor-lantern");
    const phoneSession = (await listSessions(laptop)).find((session) => !session.current);
    if (!phoneSession) throw new Error("expected the phone's session");
    expect(phoneSession.authMethod).toBe("password");
    expect((await listSessions(laptop)).find((session) => session.current)?.authMethod).toBe(
      "sign_up_link",
    );

    await expireConfirmation(email);
    const blocked = await laptop.delete(`/auth/sessions/${phoneSession.id}`);
    expect(blocked.statusCode).toBe(403);
    expect(errorOf(blocked).code).toBe("reauthentication_required");
    expect(errorOf(await laptop.post("/auth/sessions/revoke-others")).code).toBe(
      "reauthentication_required",
    );

    const wrong = await laptop.post("/auth/reauthenticate", { password: "not-my-password" });
    expect(wrong.statusCode).toBe(400);
    expect(errorOf(wrong).details).toEqual(["password: That isn’t your password."]);

    const confirmed = await laptop.post("/auth/reauthenticate", {
      password: "violet-harbor-lantern",
    });
    expect(confirmed.statusCode).toBe(200);
    const until = Date.parse(confirmed.json<{ confirmedUntil: string }>().confirmedUntil);
    expect(until - Date.now()).toBeGreaterThan(9 * 60 * 1000);

    expect((await laptop.delete(`/auth/sessions/${phoneSession.id}`)).statusCode).toBe(204);
    expect(await eventTypes(email)).toContain("reauthenticated");
  });

  it("locks re-confirmation after repeated wrong passwords", async () => {
    const client = browser();
    await signUp(client, uniqueEmail("reauth-lock"), "violet-harbor-lantern");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (
          await client.post("/auth/reauthenticate", {
            password: `wrong-${String(attempt)}-password`,
          })
        ).statusCode,
      ).toBe(400);
    }
    const locked = await client.post("/auth/reauthenticate", { password: "violet-harbor-lantern" });
    expect(locked.statusCode).toBe(429);
  });
});

describe("locking a session", () => {
  const sessionOf = (response: LightMyRequestResponse) =>
    currentSessionResponseSchema.parse(response.json()).session;

  it("answers only unlocking and signing out until the owner confirms it's them", async () => {
    const email = uniqueEmail("lock");
    const laptop = browser();
    const phone = browser(IPHONE_SAFARI);
    await signUp(laptop, email, "violet-harbor-lantern");
    await signIn(phone, email, "violet-harbor-lantern");
    expect(sessionOf(await laptop.get("/auth/session")).locked).toBe(false);

    expect((await laptop.post("/auth/session/lock")).statusCode).toBe(204);
    // Locking again changes nothing.
    expect((await laptop.post("/auth/session/lock")).statusCode).toBe(204);
    expect(sessionOf(await laptop.get("/auth/session")).locked).toBe(true);
    // Open pages notice from their passive check, which doesn't count as activity either.
    expect((await laptop.get("/auth/session/status")).statusCode).toBe(423);
    for (const request of [
      () => laptop.get("/profiles"),
      () => laptop.get("/browser"),
      () => laptop.get("/security/overview"),
      () => laptop.post("/auth/refresh"),
    ]) {
      const refused = await request();
      expect(refused.statusCode).toBe(423);
      expect(errorOf(refused).code).toBe("session_locked");
    }
    // Only this device is locked.
    expect((await phone.get("/profiles")).statusCode).toBe(200);

    // Nothing counts as activity while it's locked.
    const lastSeen = async () =>
      (
        await database.pool.query<{ last_seen_at: Date }>(
          `select s.last_seen_at from auth_sessions s join users u on u.id = s.user_id
           where u.email = $1 and s.locked_at is not null`,
          [email],
        )
      ).rows[0]?.last_seen_at.getTime();
    await database.pool.query(
      `update auth_sessions set last_seen_at = now() - interval '10 minutes'
       where locked_at is not null and user_id = (select id from users where email = $1)`,
      [email],
    );
    const before = await lastSeen();
    await laptop.get("/auth/session");
    await laptop.get("/profiles");
    expect(await lastSeen()).toBe(before);

    // A wrong password leaves it locked; the right one unlocks it.
    expect(
      (await laptop.post("/auth/reauthenticate", { password: "not-my-password" })).statusCode,
    ).toBe(400);
    expect(sessionOf(await laptop.get("/auth/session")).locked).toBe(true);
    const unlocked = await laptop.post("/auth/reauthenticate", {
      password: "violet-harbor-lantern",
    });
    expect(unlocked.statusCode).toBe(200);
    expect(sessionOf(await laptop.get("/auth/session")).locked).toBe(false);
    expect((await laptop.get("/profiles")).statusCode).toBe(200);

    const types = await eventTypes(email);
    expect(types).toContain("session.locked");
    expect(types).toContain("session.unlocked");
    expect(types.filter((type) => type === "session.locked")).toHaveLength(1);
    const history = securityEventPageSchema.parse((await laptop.get("/security/events")).json());
    expect(history.events.map((event) => event.type).slice(0, 2)).toEqual([
      "session.unlocked",
      "session.locked",
    ]);
  });

  it("can always sign out, even while locked", async () => {
    const client = browser();
    await signUp(client, uniqueEmail("lock-out"), "violet-harbor-lantern");
    await client.post("/auth/session/lock");
    const token = client.session;
    expect((await client.post("/auth/logout")).statusCode).toBe(204);
    const replay = browser();
    replay.session = token;
    expect((await replay.get("/auth/session")).statusCode).toBe(401);
  });

  it("ends a locked session after its idle time, as an unlocked one", async () => {
    const email = uniqueEmail("lock-idle");
    const client = browser();
    await signUp(client, email, "violet-harbor-lantern");
    await client.post("/auth/session/lock");
    await database.pool.query(
      `update auth_sessions set last_seen_at = now() - interval '31 minutes'
       where user_id = (select id from users where email = $1)`,
      [email],
    );
    expect((await client.get("/auth/session")).statusCode).toBe(401);
  });
});
