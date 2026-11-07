import {
  currentSessionResponseSchema,
  mfaChallengeSchema,
  mfaStatusSchema,
  passkeyOptionsResponseSchema,
  recoveryCodesResponseSchema,
  totpSetupResponseSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";
import { SoftAuthenticator } from "./support/soft-authenticator.js";
import { totp } from "./support/totp.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "198.18.0" });
});

afterAll(async () => {
  await h.close();
});

const PASSWORD = "violet-harbor-lantern";

/** A signed-in account with two-factor turned on. */
async function withTwoFactor(
  tag: string,
): Promise<{ email: string; client: TestBrowser; secret: string; codes: string[] }> {
  const email = h.uniqueEmail(tag);
  const client = h.browser();
  await h.signUp(client, email, PASSWORD);
  const setup = totpSetupResponseSchema.parse((await client.post("/auth/mfa/totp/setup")).json());
  const confirmed = await client.post("/auth/mfa/totp/confirm", { code: totp(setup.secret) });
  const { recoveryCodes } = recoveryCodesResponseSchema.parse(confirmed.json());
  return { email, client, secret: setup.secret, codes: recoveryCodes };
}

async function passwordStep(client: TestBrowser, email: string) {
  const response = await client.post("/auth/login", { email, password: PASSWORD });
  expect(response.statusCode).toBe(200);
  return mfaChallengeSchema.parse(response.json());
}

describe("turning two-factor authentication on", () => {
  it("needs a correct first code, stores the secret encrypted and returns recovery codes once", async () => {
    const email = h.uniqueEmail("mfa-setup");
    const client = h.browser();
    await h.signUp(client, email, PASSWORD);

    const setup = totpSetupResponseSchema.parse((await client.post("/auth/mfa/totp/setup")).json());
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\/Brawzer:/);
    expect(setup.qrSvg).toMatch(/^<svg/);
    const { rows } = await h.database.pool.query<{ secret: string }>(
      "select secret from totp_factors where user_id = (select id from users where email = $1)",
      [email],
    );
    expect(rows[0]?.secret.startsWith("v1.")).toBe(true);
    expect(rows[0]?.secret).not.toContain(setup.secret);

    const wrong = await client.post("/auth/mfa/totp/confirm", { code: "000000" });
    expect(wrong.statusCode).toBe(400);
    expect(mfaStatusSchema.parse((await client.get("/auth/mfa")).json()).totpEnabled).toBe(false);

    const confirmed = await client.post("/auth/mfa/totp/confirm", { code: totp(setup.secret) });
    const { recoveryCodes } = recoveryCodesResponseSchema.parse(confirmed.json());
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(mfaStatusSchema.parse((await client.get("/auth/mfa")).json())).toMatchObject({
      totpEnabled: true,
      recoveryCodesRemaining: 10,
    });
    expect(await h.waitForEmail(email, "Two-factor authentication is on")).toContain(
      "authenticator app",
    );
    expect(await h.eventTypes(email)).toContain("mfa.enabled");

    expect((await client.post("/auth/mfa/totp/setup")).statusCode).toBe(409);
  });

  it("needs a recent sign-in", async () => {
    const email = h.uniqueEmail("mfa-recent");
    const client = h.browser();
    await h.signUp(client, email, PASSWORD);
    await h.expireConfirmation(email);
    expect(h.errorOf(await client.post("/auth/mfa/totp/setup")).code).toBe(
      "reauthentication_required",
    );
  });
});

describe("signing in with two-factor authentication", () => {
  it("asks for a code after the password, then signs in", async () => {
    const { email, secret } = await withTwoFactor("mfa-signin");
    const computer = h.browser();
    const challenge = await passwordStep(computer, email);
    expect(computer.session).toBeUndefined();

    const wrong = await computer.post("/auth/mfa/verify", {
      ticket: challenge.ticket,
      code: "123456",
    });
    expect(wrong.statusCode).toBe(400);
    expect(h.errorOf(wrong).details?.[0]).toMatch(/^code: /);

    const verified = await computer.post("/auth/mfa/verify", {
      ticket: challenge.ticket,
      code: totp(secret, 1),
    });
    expect(verified.statusCode).toBe(200);
    expect(currentSessionResponseSchema.parse(verified.json()).session.authMethod).toBe(
      "password_totp",
    );
    expect((await computer.get("/auth/session")).statusCode).toBe(200);

    // The ticket and the code are both used up.
    expect(
      (await computer.post("/auth/mfa/verify", { ticket: challenge.ticket, code: totp(secret, 1) }))
        .statusCode,
    ).toBe(401);
    const again = await passwordStep(h.browser(), email);
    const replay = await h
      .browser()
      .post("/auth/mfa/verify", { ticket: again.ticket, code: totp(secret, 1) });
    expect(replay.statusCode).toBe(400);
  });

  it("accepts each recovery code once and tells the owner", async () => {
    const { email, codes } = await withTwoFactor("mfa-recovery");
    const code = codes[0] ?? "";
    const first = await passwordStep(h.browser(), email);
    const signedIn = await h
      .browser()
      .post("/auth/mfa/verify", { ticket: first.ticket, code: code.toUpperCase() });
    expect(signedIn.statusCode).toBe(200);
    expect(await h.waitForEmail(email, "A recovery code was used")).toContain(
      "9 recovery codes are left",
    );

    const second = await passwordStep(h.browser(), email);
    expect(
      (await h.browser().post("/auth/mfa/verify", { ticket: second.ticket, code })).statusCode,
    ).toBe(400);
    expect(await h.eventTypes(email)).toContain("mfa.recovery_code_used");
  });

  it("burns a ticket after 5 wrong codes", async () => {
    const { email, secret } = await withTwoFactor("mfa-burn");
    const challenge = await passwordStep(h.browser(), email);
    const computer = h.browser();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(
        (await computer.post("/auth/mfa/verify", { ticket: challenge.ticket, code: "000000" }))
          .statusCode,
      ).toBe(400);
    }
    const fifth = await computer.post("/auth/mfa/verify", {
      ticket: challenge.ticket,
      code: "000000",
    });
    expect(fifth.statusCode).toBe(401);
    expect(h.errorOf(fifth).message).toMatch(/Too many wrong codes/);
    expect(
      (await computer.post("/auth/mfa/verify", { ticket: challenge.ticket, code: totp(secret) }))
        .statusCode,
    ).toBe(401);
  });

  it("refuses forged tickets", async () => {
    const forged = await h.browser().post("/auth/mfa/verify", {
      ticket: `01a1b375-3674-7441-b1c2-5d6916907998.${"A".repeat(43)}`,
      code: "123456",
    });
    expect(forged.statusCode).toBe(401);
    expect(h.errorOf(forged).code).toBe("token_invalid");
  });

  it("skips the second step for passkey sign-in, which is already two factors", async () => {
    const email = h.uniqueEmail("mfa-passkey");
    await h.signUp(h.browser(), email, PASSWORD);
    const own = h.browser();
    await h.signIn(own, email, PASSWORD, true);
    const setup = totpSetupResponseSchema.parse((await own.post("/auth/mfa/totp/setup")).json());
    await own.post("/auth/mfa/totp/confirm", { code: totp(setup.secret) });

    const device = new SoftAuthenticator({ rpId: h.config.webauthn.rpId, origin: h.origin });
    const options = passkeyOptionsResponseSchema.parse(
      (await own.post("/auth/passkeys/registration/options")).json(),
    );
    await own.post("/auth/passkeys/registration/verify", {
      challengeId: options.challengeId,
      response: device.register(options.options),
    });

    const computer = h.browser();
    const signIn = passkeyOptionsResponseSchema.parse(
      (await computer.post("/auth/passkeys/authentication/options")).json(),
    );
    const result = await computer.post("/auth/passkeys/authentication/verify", {
      challengeId: signIn.challengeId,
      response: device.authenticate(signIn.options),
    });
    expect(result.statusCode).toBe(200);
    expect(currentSessionResponseSchema.parse(result.json()).session.authMethod).toBe("passkey");
  });
});

describe("managing two-factor authentication", () => {
  it("asks for a code when confirming it's you with the password", async () => {
    const { email, client, secret } = await withTwoFactor("mfa-reauth");
    await h.expireConfirmation(email);
    const passwordOnly = await client.post("/auth/reauthenticate", { password: PASSWORD });
    expect(passwordOnly.statusCode).toBe(400);
    expect(h.errorOf(passwordOnly).details).toEqual([
      "code: Enter the 6-digit code from your authenticator app.",
    ]);
    expect(
      (await client.post("/auth/reauthenticate", { password: PASSWORD, code: totp(secret, 1) }))
        .statusCode,
    ).toBe(200);
  });

  it("creates new recovery codes, retiring the old ones", async () => {
    const { email, client, codes } = await withTwoFactor("mfa-regenerate");
    const fresh = recoveryCodesResponseSchema.parse(
      (await client.post("/auth/mfa/recovery-codes")).json(),
    ).recoveryCodes;
    expect(fresh).not.toEqual(codes);
    const challenge = await passwordStep(h.browser(), email);
    expect(
      (
        await h
          .browser()
          .post("/auth/mfa/verify", { ticket: challenge.ticket, code: codes[0] ?? "" })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await h
          .browser()
          .post("/auth/mfa/verify", { ticket: challenge.ticket, code: fresh[0] ?? "" })
      ).statusCode,
    ).toBe(200);
  });

  it("turns off after confirming it's you, and sign-in goes back to the password alone", async () => {
    const { email, client } = await withTwoFactor("mfa-off");
    expect((await client.delete("/auth/mfa/totp")).statusCode).toBe(204);
    expect(mfaStatusSchema.parse((await client.get("/auth/mfa")).json()).totpEnabled).toBe(false);
    const signIn = await h.browser().post("/auth/login", { email, password: PASSWORD });
    expect(currentSessionResponseSchema.safeParse(signIn.json()).success).toBe(true);
    expect(await h.waitForEmail(email, "Two-factor authentication was turned off")).toContain(
      "turned off",
    );
  });
});
