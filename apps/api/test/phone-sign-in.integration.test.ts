import {
  passkeyOptionsResponseSchema,
  currentSessionResponseSchema,
  phoneApprovalSchema,
  phoneSignInPollResponseSchema,
  phoneSignInStartResponseSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SoftAuthenticator } from "./support/soft-authenticator.js";
import {
  createHarness,
  type Harness,
  type TestBrowser,
  WINDOWS_CHROME,
} from "./support/harness.js";

// Requires the local services (`pnpm infra:up`).
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.74.0" });
});

afterAll(async () => {
  await h.close();
});

/** The computer: no session, a request started. */
async function computer() {
  const client = h.browser();
  const started = await client.post("/auth/phone/start", {}, { "user-agent": WINDOWS_CHROME });
  expect(started.statusCode, started.body).toBe(201);
  const request = phoneSignInStartResponseSchema.parse(started.json());
  const key = new URL(request.approvalUrl).searchParams.get("k") ?? "";
  return { client, request, key };
}

async function poll(client: TestBrowser, requestId: string, pollToken: string) {
  const response = await client.post(`/auth/phone/${requestId}/poll`, { pollToken });
  expect(response.statusCode, response.body).toBe(200);
  return phoneSignInPollResponseSchema.parse(response.json());
}

async function phone(tag: string) {
  const client = h.browser();
  const email = h.uniqueEmail(tag);
  await h.signUp(client, email);
  return { client, email };
}

describe("sign in with your phone", () => {
  it("shows a code and a number, lets the phone approve with the right number, and signs the computer in once", async () => {
    const { client, request, key } = await computer();
    expect(request.qrSvg).toContain("<svg");
    expect(request.code).toMatch(/^[1-9][0-9]$/);
    expect(await poll(client, request.requestId, request.pollToken)).toEqual({ state: "pending" });

    const { client: mobile, email } = await phone("phone-approver");
    const seen = await mobile.get(`/auth/phone/${request.requestId}?key=${key}`);
    expect(seen.statusCode, seen.body).toBe(200);
    const approval = phoneApprovalSchema.parse(seen.json());
    expect(approval.state).toBe("pending");
    expect(approval.device).toContain("Chrome");
    expect(approval.codes).toContain(request.code);
    expect(new Set(approval.codes).size).toBe(3);

    // A wrong number counts; the right one approves.
    const wrong = approval.codes.find((code) => code !== request.code) ?? "";
    const refused = await mobile.post(`/auth/phone/${request.requestId}/approve`, {
      key,
      code: wrong,
    });
    expect(refused.statusCode).toBe(400);
    const approved = await mobile.post(`/auth/phone/${request.requestId}/approve`, {
      key,
      code: request.code,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(phoneApprovalSchema.parse(approved.json()).state).toBe("approved");

    // The computer polls and is signed in, as a shared-computer session, once.
    const result = await poll(client, request.requestId, request.pollToken);
    expect(result.state).toBe("approved");
    if (result.state === "approved") {
      expect(result.account.email).toBe(email);
      expect(result.session.persistent).toBe(false);
      expect(result.session.authMethod).toBe("phone");
    }
    expect(client.session).toBeDefined();
    const me = await client.get("/auth/session");
    expect(currentSessionResponseSchema.parse(me.json()).account.email).toBe(email);
    expect(await poll(h.browser(), request.requestId, request.pollToken)).toEqual({
      state: "expired",
    });
    expect(await h.eventTypes(email)).toEqual(
      expect.arrayContaining(["phone_sign_in.approved", "sign_in.succeeded"]),
    );
    await h.waitForEmail(email, "You approved a sign-in from your phone");
  });

  it("refuses the request after three wrong numbers, needs a recent sign-in, and takes 'not me'", async () => {
    const { client, request, key } = await computer();
    const { client: mobile, email } = await phone("phone-wrong");
    const wrong = () =>
      mobile.post(`/auth/phone/${request.requestId}/approve`, {
        key,
        code: request.code === "99" ? "98" : "99",
      });
    expect((await wrong()).statusCode).toBe(400);
    expect((await wrong()).statusCode).toBe(400);
    expect((await wrong()).statusCode).toBe(403);
    expect(await poll(client, request.requestId, request.pollToken)).toEqual({ state: "denied" });
    // Too late to approve now, even with the right number.
    const late = await mobile.post(`/auth/phone/${request.requestId}/approve`, {
      key,
      code: request.code,
    });
    expect(late.statusCode).toBe(409);

    const second = await computer();
    await h.expireConfirmation(email);
    const stale = await mobile.post(`/auth/phone/${second.request.requestId}/approve`, {
      key: second.key,
      code: second.request.code,
    });
    expect(stale.statusCode).toBe(403);
    expect(h.errorOf(stale).code).toBe("reauthentication_required");
    const denied = await mobile.post(`/auth/phone/${second.request.requestId}/deny`, {
      key: second.key,
    });
    expect(denied.statusCode).toBe(200);
    expect(await poll(second.client, second.request.requestId, second.request.pollToken)).toEqual({
      state: "denied",
    });
  });

  it("keeps the two secrets apart: the key alone can't poll, the poll token alone can't approve, and strangers see nothing", async () => {
    const { client, request, key } = await computer();
    const wrongPoll = await client.post(`/auth/phone/${request.requestId}/poll`, {
      pollToken: key,
    });
    expect(phoneSignInPollResponseSchema.parse(wrongPoll.json())).toEqual({ state: "expired" });
    const { client: mobile } = await phone("phone-secrets");
    const wrongKey = await mobile.get(`/auth/phone/${request.requestId}?key=${request.pollToken}`);
    expect(wrongKey.statusCode).toBe(404);
    const anonymous = await h.browser().get(`/auth/phone/${request.requestId}?key=${key}`);
    expect(anonymous.statusCode).toBe(401);
    // The computer never holds a session until the phone approves.
    expect(client.session).toBeUndefined();
  });

  it("needs a passkey to approve whenever the account has one", async () => {
    const { client, request, key } = await computer();
    const { client: mobile } = await phone("phone-passkey");
    // A security key: on a shared-computer session, that is the kind that may be added.
    const device = new SoftAuthenticator({
      rpId: h.config.webauthn.rpId,
      origin: h.origin,
      attachment: "cross-platform",
      synced: false,
    });
    const registration = passkeyOptionsResponseSchema.parse(
      (await mobile.post("/auth/passkeys/registration/options")).json(),
    );
    const saved = await mobile.post("/auth/passkeys/registration/verify", {
      challengeId: registration.challengeId,
      response: device.register(registration.options),
    });
    expect([200, 201], saved.body).toContain(saved.statusCode);

    // The phone signed in with a password: approving is refused, and the reason names the passkey.
    const refused = await mobile.post(`/auth/phone/${request.requestId}/approve`, {
      key,
      code: request.code,
    });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(h.errorOf(refused).code).toBe("reauthentication_required");
    expect(h.errorOf(refused).details).toContain("method: passkey");

    // Confirming with the password changes nothing; confirming with the passkey does.
    const byPassword = await mobile.post("/auth/reauthenticate", {
      password: "violet-harbor-lantern",
    });
    expect(byPassword.statusCode, byPassword.body).toBe(200);
    expect(
      (await mobile.post(`/auth/phone/${request.requestId}/approve`, { key, code: request.code }))
        .statusCode,
    ).toBe(403);
    const confirmation = passkeyOptionsResponseSchema.parse(
      (await mobile.post("/auth/passkeys/confirmation/options")).json(),
    );
    const confirmed = await mobile.post("/auth/passkeys/confirmation/verify", {
      challengeId: confirmation.challengeId,
      response: device.authenticate(confirmation.options),
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const approved = await mobile.post(`/auth/phone/${request.requestId}/approve`, {
      key,
      code: request.code,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect((await poll(client, request.requestId, request.pollToken)).state).toBe("approved");
  });
});
