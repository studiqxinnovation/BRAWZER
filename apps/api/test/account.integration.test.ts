import {
  accountExportSchema,
  confirmEmailChangeResponseSchema,
  securityOverviewSchema,
  totpSetupResponseSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, IPHONE_SAFARI, type TestBrowser } from "./support/harness.js";
import { totp } from "./support/totp.js";

// Requires the local services: `pnpm infra:up`.
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "203.0.113" });
});

afterAll(async () => {
  await h.close();
});

const PASSWORD = "violet-harbor-lantern";

async function account(tag: string): Promise<{ email: string; client: TestBrowser }> {
  const email = h.uniqueEmail(tag);
  const client = h.browser();
  await h.signUp(client, email, PASSWORD);
  return { email, client };
}

async function userExists(email: string): Promise<boolean> {
  const { rows } = await h.database.pool.query("select 1 from users where email = $1", [email]);
  return rows.length === 1;
}

describe("changing the email address", () => {
  it("needs a recent sign-in", async () => {
    const { email, client } = await account("email-reauth");
    await h.expireConfirmation(email);
    const response = await client.post("/account/email", { email: h.uniqueEmail("elsewhere") });
    expect(response.statusCode).toBe(403);
    expect(h.errorOf(response).code).toBe("reauthentication_required");
  });

  it("switches only after the new address is confirmed, and tells the old one both times", async () => {
    const { email, client } = await account("email-change");
    const newEmail = h.uniqueEmail("email-new");

    const requested = await client.post("/account/email", { email: newEmail });
    expect(requested.statusCode).toBe(202);
    const notice = await h.waitForEmail(email, "Your Brawzer email address may change");
    expect(notice).toContain("changes only if that address is confirmed");
    expect(notice).not.toContain(newEmail); // masked
    const token = h.tokenIn(await h.waitForEmail(newEmail, "Confirm your new email address"));

    // Nothing has changed yet.
    expect(await userExists(email)).toBe(true);

    const anyone = h.browser();
    const confirmed = await anyone.post("/account/email/confirm", { token });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmEmailChangeResponseSchema.parse(confirmed.json()).email).toBe(newEmail);
    await h.waitForEmail(email, "Your Brawzer email address was changed");

    const session = await client.get("/auth/session");
    expect(session.json<{ account: { email: string } }>().account.email).toBe(newEmail);
    const oldLogin = await h.browser().post("/auth/login", { email, password: PASSWORD });
    expect(oldLogin.statusCode).toBe(401);
    await h.signIn(h.browser(), newEmail);
    expect(await h.eventTypes(newEmail)).toEqual(
      expect.arrayContaining(["email.change_requested", "email.changed"]),
    );

    const again = await anyone.post("/account/email/confirm", { token });
    expect(again.statusCode).toBe(400);
    expect(h.errorOf(again).code).toBe("token_invalid");
  });

  it("refuses the address the account already has", async () => {
    const { email, client } = await account("email-same");
    const response = await client.post("/account/email", { email });
    expect(response.statusCode).toBe(400);
    expect(h.errorOf(response).details).toEqual(["email: That’s already your email address."]);
  });

  it("answers the same for an address another account uses, and only that inbox learns why", async () => {
    const { client } = await account("email-taken-a");
    const { email: taken } = await account("email-taken-b");

    const response = await client.post("/account/email", { email: taken });
    expect(response.statusCode).toBe(202);
    const text = await h.waitForEmail(taken, "Someone tried to use your email");
    expect(text).not.toMatch(/#token=/);
    expect(await h.emailsTo(taken, "Confirm your new email address")).toHaveLength(0);
  });

  it("takes over an address whose sign-up was never confirmed", async () => {
    const { email, client } = await account("email-placeholder-owner");
    const placeholder = h.uniqueEmail("email-placeholder");
    const registered = await h.browser().post("/auth/register", {
      name: "Ana Silva",
      email: placeholder,
      password: "someone-elses-guess",
    });
    expect(registered.statusCode).toBe(202);
    expect(await userExists(placeholder)).toBe(true);

    const { rows: before } = await h.database.pool.query<{ id: string }>(
      "select id from users where email = $1",
      [email],
    );
    await client.post("/account/email", { email: placeholder });
    const token = h.tokenIn(await h.waitForEmail(placeholder, "Confirm your new email address"));
    const confirmed = await h.browser().post("/account/email/confirm", { token });
    expect(confirmed.statusCode).toBe(200);
    expect(await userExists(email)).toBe(false);
    const { rows: after } = await h.database.pool.query<{ id: string }>(
      "select id from users where email = $1",
      [placeholder],
    );
    expect(after).toEqual(before);
    // The placeholder's password never worked and still doesn't.
    const guess = await h.browser().post("/auth/login", {
      email: placeholder,
      password: "someone-elses-guess",
    });
    expect(guess.statusCode).toBe(401);
  });

  it("refuses to confirm if the address was taken in the meantime", async () => {
    const { client } = await account("email-race-a");
    const contested = h.uniqueEmail("email-race");
    await client.post("/account/email", { email: contested });
    const token = h.tokenIn(await h.waitForEmail(contested, "Confirm your new email address"));
    await h.signUp(h.browser(), contested, PASSWORD);

    const confirmed = await h.browser().post("/account/email/confirm", { token });
    expect(confirmed.statusCode).toBe(409);
    expect(h.errorOf(confirmed).code).toBe("conflict");
  });

  it("keeps only the newest request, and a password change cancels it", async () => {
    const { client } = await account("email-newest");
    const first = h.uniqueEmail("email-first");
    const second = h.uniqueEmail("email-second");
    await client.post("/account/email", { email: first });
    const firstToken = h.tokenIn(await h.waitForEmail(first, "Confirm your new email address"));
    await client.post("/account/email", { email: second });
    const secondToken = h.tokenIn(await h.waitForEmail(second, "Confirm your new email address"));

    const stale = await h.browser().post("/account/email/confirm", { token: firstToken });
    expect(stale.statusCode).toBe(400);

    const changed = await client.post("/auth/password/change", {
      currentPassword: PASSWORD,
      newPassword: "copper-meadow-whistle",
    });
    expect(changed.statusCode).toBe(200);
    const cancelled = await h.browser().post("/account/email/confirm", { token: secondToken });
    expect(cancelled.statusCode).toBe(400);
    expect(h.errorOf(cancelled).code).toBe("token_invalid");
  });
});

describe("deleting the account", () => {
  it("needs a recent sign-in and the email address typed exactly", async () => {
    const { email, client } = await account("delete-guard");
    const wrong = await client.post("/account/delete", { email: "someone@example.com" });
    expect(wrong.statusCode).toBe(400);
    expect(h.errorOf(wrong).code).toBe("validation_failed");

    await h.expireConfirmation(email);
    const stale = await client.post("/account/delete", { email });
    expect(stale.statusCode).toBe(403);
    expect(h.errorOf(stale).code).toBe("reauthentication_required");
    expect(await userExists(email)).toBe(true);
  });

  it("deletes everything at once, signs every device out and confirms by email", async () => {
    const { email, client } = await account("delete-now");
    const phone = h.browser(IPHONE_SAFARI);
    await h.signIn(phone, email);
    const setup = totpSetupResponseSchema.parse((await client.post("/auth/mfa/totp/setup")).json());
    await client.post("/auth/mfa/totp/confirm", { code: totp(setup.secret) });

    const { rows: owner } = await h.database.pool.query<{ id: string }>(
      "select id from users where email = $1",
      [email],
    );
    const userId = owner[0]?.id;
    expect(userId).toBeDefined();

    const deleted = await client.post("/account/delete", { email: ` ${email.toUpperCase()} ` });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.headers["clear-site-data"]).toContain('"storage"');
    expect(client.session).toBeUndefined();
    await h.waitForEmail(email, "Your Brawzer account was deleted");

    expect(await userExists(email)).toBe(false);
    const tables = [
      "auth_sessions",
      "security_events",
      "email_tokens",
      "totp_factors",
      "recovery_codes",
      "known_devices",
    ];
    for (const table of tables) {
      const { rows } = await h.database.pool.query<{ count: number }>(
        `select count(*)::int as count from ${table} where user_id = $1`,
        [userId],
      );
      expect(rows[0]?.count, table).toBe(0);
    }
    expect((await phone.get("/auth/session")).statusCode).toBe(401);
    const login = await h.browser().post("/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(401);
  });
});

describe("downloading your data", () => {
  it("needs a recent sign-in", async () => {
    const { email, client } = await account("export-guard");
    await h.expireConfirmation(email);
    const response = await client.get("/account/export");
    expect(response.statusCode).toBe(403);
  });

  it("returns the account's data as an attachment, without any secrets", async () => {
    const { email, client } = await account("export");
    const setup = totpSetupResponseSchema.parse((await client.post("/auth/mfa/totp/setup")).json());
    await client.post("/auth/mfa/totp/confirm", { code: totp(setup.secret) });

    const response = await client.get("/account/export");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="brawzer-account-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers["cache-control"]).toContain("no-store");
    const data = accountExportSchema.parse(response.json());
    expect(data.account.email).toBe(email);
    expect(data.twoFactor).toEqual({ enabled: true, recoveryCodesRemaining: 10 });
    expect(data.sessions).toHaveLength(1);
    expect(data.securityHistory.map((event) => event.type)).toEqual(
      expect.arrayContaining(["email.verified", "mfa.enabled"]),
    );

    const { rows } = await h.database.pool.query<{ password_hash: string; token_hash: string }>(
      `select u.password_hash, s.token_hash from users u join auth_sessions s on s.user_id = u.id
       where u.email = $1`,
      [email],
    );
    const raw = response.body;
    expect(raw).not.toContain(setup.secret);
    expect(raw).not.toContain("$argon2");
    expect(raw).not.toContain(rows[0]?.token_hash ?? "missing");
    expect(raw).not.toContain(client.session ?? "missing");
    expect(await h.eventTypes(email)).toContain("data.exported");
  });
});

describe("new-device alerts", () => {
  it("emails and records a sign-in from a browser or network the account hasn't used", async () => {
    const { email } = await account("new-device");
    // Same browser, same network as the sign-up: nothing to report.
    await h.signIn(h.browser(), email);
    expect(await h.emailsTo(email, "New sign-in to your Brawzer account")).toHaveLength(0);

    await h.signIn(h.browser(IPHONE_SAFARI), email);
    const alert = await h.waitForEmail(email, "New sign-in to your Brawzer account");
    expect(alert).toContain("Safari on iOS");
    expect(alert).toContain("/app/sessions");

    // The same phone again is known now.
    await h.signIn(h.browser(IPHONE_SAFARI), email);
    // The usual browser from another network is new.
    await h.signIn(h.browser(undefined, "192.0.2.77"), email);
    await h.waitForEmail(email, "New sign-in to your Brawzer account", 2);
    expect(await h.emailsTo(email, "New sign-in to your Brawzer account")).toHaveLength(2);
    expect(
      (await h.eventTypes(email)).filter((type) => type === "sign_in.new_device"),
    ).toHaveLength(2);
  });
});

describe("the Shield overview", () => {
  it("recommends protection and reports failed attempts and new devices", async () => {
    const { email, client } = await account("overview");
    const fresh = securityOverviewSchema.parse((await client.get("/security/overview")).json());
    expect(fresh).toMatchObject({
      passkeys: 0,
      twoFactorEnabled: false,
      signedInDevices: 1,
      recentFailedAttempts: 0,
      newDeviceSignIns: [],
    });
    expect(fresh.recommendations.map((item) => item.id)).toEqual([
      "add_passkey",
      "enable_two_factor",
    ]);

    await h.browser().post("/auth/login", { email, password: "not-my-password" });
    for (let i = 0; i < 3; i++) await h.signIn(h.browser(IPHONE_SAFARI), email);
    const setup = totpSetupResponseSchema.parse((await client.post("/auth/mfa/totp/setup")).json());
    await client.post("/auth/mfa/totp/confirm", { code: totp(setup.secret) });

    const later = securityOverviewSchema.parse((await client.get("/security/overview")).json());
    expect(later.twoFactorEnabled).toBe(true);
    expect(later.recentFailedAttempts).toBe(1);
    expect(later.signedInDevices).toBe(4);
    expect(later.newDeviceSignIns).toHaveLength(1);
    expect(later.newDeviceSignIns[0]?.device).toBe("Safari on iOS");
    expect(later.recommendations.map((item) => item.id)).toEqual(["add_passkey", "review_devices"]);
  });

  it("needs a session", async () => {
    expect((await h.browser().get("/security/overview")).statusCode).toBe(401);
  });
});

describe("undoing an email change", () => {
  /** Changes `email` to a new address through the real flow; returns the undo link's token. */
  async function changed(tag: string) {
    const { email, client } = await account(tag);
    const newEmail = h.uniqueEmail(`${tag}-new`);
    await client.post("/account/email", { email: newEmail });
    const token = h.tokenIn(await h.waitForEmail(newEmail, "Confirm your new email address"));
    expect((await h.browser().post("/account/email/confirm", { token })).statusCode).toBe(200);
    const notice = await h.waitForEmail(email, "Your Brawzer email address was changed");
    expect(notice).toContain("/undo-email-change#token=");
    return { email, newEmail, client, undoToken: h.tokenIn(notice) };
  }

  it("restores the old address, sets a new password and signs out every device", async () => {
    const { email, newEmail, client, undoToken } = await changed("undo");
    const phone = h.browser(IPHONE_SAFARI);
    await h.signIn(phone, newEmail);

    const weak = await h.browser().post("/account/email/undo", {
      token: undoToken,
      password: "password1234",
    });
    expect(weak.statusCode).toBe(400);
    expect(h.errorOf(weak).code).toBe("validation_failed");

    const undone = await h.browser().post("/account/email/undo", {
      token: undoToken,
      password: "copper-meadow-whistle",
    });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json<{ email: string }>().email).toBe(email);

    // Every device is out, including the one that made the change.
    expect((await client.get("/auth/session")).statusCode).toBe(401);
    expect((await phone.get("/auth/session")).statusCode).toBe(401);
    // The new address and the old password are both gone.
    expect(
      (await h.browser().post("/auth/login", { email: newEmail, password: PASSWORD })).statusCode,
    ).toBe(401);
    expect((await h.browser().post("/auth/login", { email, password: PASSWORD })).statusCode).toBe(
      401,
    );
    await h.signIn(h.browser(), email, "copper-meadow-whistle");

    await h.waitForEmail(email, "Your Brawzer email address was restored");
    await h.waitForEmail(newEmail, "This address was removed from a Brawzer account");
    expect(await h.eventTypes(email)).toEqual(
      expect.arrayContaining(["email.change_undone", "password.reset", "sessions.revoked"]),
    );

    // The link works once.
    const again = await h.browser().post("/account/email/undo", {
      token: undoToken,
      password: "copper-meadow-whistle",
    });
    expect(again.statusCode).toBe(400);
    expect(h.errorOf(again).code).toBe("token_invalid");
  });

  it("cancels a later pending change and refuses if the old address is now someone else's", async () => {
    const { newEmail, client, undoToken } = await changed("undo-pending");
    // A further change is requested but not confirmed; undoing cancels it.
    await h.signIn(client, newEmail);
    const third = h.uniqueEmail("undo-third");
    expect((await client.post("/account/email", { email: third })).statusCode).toBe(202);
    const thirdToken = h.tokenIn(await h.waitForEmail(third, "Confirm your new email address"));
    expect(
      (
        await h
          .browser()
          .post("/account/email/undo", { token: undoToken, password: "copper-meadow-whistle" })
      ).statusCode,
    ).toBe(200);
    const stale = await h.browser().post("/account/email/confirm", { token: thirdToken });
    expect(stale.statusCode).toBe(400);

    const taken = await changed("undo-taken");
    // Someone else registered and confirmed the old address in the meantime.
    // (That inbox already holds the original sign-up email, so wait for the second one.)
    const newcomer = h.browser();
    expect(
      (
        await newcomer.post("/auth/register", {
          name: "Ana Silva",
          email: taken.email,
          password: PASSWORD,
        })
      ).statusCode,
    ).toBe(202);
    const signUpToken = h.tokenIn(await h.waitForEmail(taken.email, "Confirm your email", 2));
    expect(
      (await newcomer.post("/auth/verify-email", { token: signUpToken, password: PASSWORD }))
        .statusCode,
    ).toBe(200);
    const refused = await h.browser().post("/account/email/undo", {
      token: taken.undoToken,
      password: "copper-meadow-whistle",
    });
    expect(refused.statusCode).toBe(409);
    expect(h.errorOf(refused).code).toBe("conflict");
    // The account keeps its current address and password.
    await h.signIn(h.browser(), taken.newEmail, PASSWORD);
  });
});
