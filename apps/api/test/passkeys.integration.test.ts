import {
  currentSessionResponseSchema,
  passkeyListSchema,
  passkeyOptionsResponseSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";
import { SoftAuthenticator } from "./support/soft-authenticator.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "192.0.2" });
});

afterAll(async () => {
  await h.close();
});

const authenticator = (attachment: "platform" | "cross-platform" = "platform", synced = true) =>
  new SoftAuthenticator({ rpId: h.config.webauthn.rpId, origin: h.origin, attachment, synced });

/** A confirmed account signed in with "keep me signed in" (its own device). */
async function ownDevice(tag: string): Promise<{ email: string; client: TestBrowser }> {
  const email = h.uniqueEmail(tag);
  await h.signUp(h.browser(), email);
  const client = h.browser();
  await h.signIn(client, email, "violet-harbor-lantern", true);
  return { email, client };
}

async function addPasskey(client: TestBrowser, device: SoftAuthenticator, name?: string) {
  const options = passkeyOptionsResponseSchema.parse(
    (await client.post("/auth/passkeys/registration/options")).json(),
  );
  return client.post("/auth/passkeys/registration/verify", {
    challengeId: options.challengeId,
    ...(name ? { name } : {}),
    response: device.register(options.options),
  });
}

async function passkeySignIn(
  client: TestBrowser,
  device: SoftAuthenticator,
  overrides: { origin?: string } = {},
) {
  const options = passkeyOptionsResponseSchema.parse(
    (await client.post("/auth/passkeys/authentication/options")).json(),
  );
  return {
    challengeId: options.challengeId,
    response: await client.post("/auth/passkeys/authentication/verify", {
      challengeId: options.challengeId,
      response: device.authenticate(options.options, overrides),
    }),
  };
}

describe("adding passkeys", () => {
  it("saves a passkey with user verification required, and tells the owner", async () => {
    const { email, client } = await ownDevice("passkey-add");
    const options = passkeyOptionsResponseSchema.parse(
      (await client.post("/auth/passkeys/registration/options")).json(),
    );
    expect(options.options).toMatchObject({
      rp: { id: h.config.webauthn.rpId, name: "Brawzer" },
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    // The WebAuthn user handle is a random value, never the email or account ID.
    const handle = (options.options.user as { id: string; name: string }).id;
    expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const account = currentSessionResponseSchema.parse(
      (await client.get("/auth/session")).json(),
    ).account;
    expect(Buffer.from(handle, "base64url").toString("utf8")).not.toContain(account.id);

    const device = authenticator();
    const saved = await client.post("/auth/passkeys/registration/verify", {
      challengeId: options.challengeId,
      name: "Work laptop",
      response: device.register(options.options),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ name: "Work laptop", synced: true, lastUsedAt: null });

    const list = passkeyListSchema.parse((await client.get("/auth/passkeys")).json());
    expect(list.passkeys.map((passkey) => passkey.name)).toEqual(["Work laptop"]);
    expect(await h.waitForEmail(email, "A passkey was added")).toContain("Work laptop");
    expect(await h.eventTypes(email)).toContain("passkey.added");
  });

  it("names a passkey after the device when no name is given", async () => {
    const { client } = await ownDevice("passkey-default-name");
    const saved = await addPasskey(client, authenticator());
    expect(saved.json()).toMatchObject({ name: "Passkey on Chrome on Windows" });
  });

  it("on a shared computer, refuses passkeys stored on the computer itself", async () => {
    const email = h.uniqueEmail("passkey-shared");
    const client = h.browser();
    await h.signUp(client, email); // a shared-computer session
    const options = passkeyOptionsResponseSchema.parse(
      (await client.post("/auth/passkeys/registration/options")).json(),
    );
    expect(options.options).toMatchObject({
      authenticatorSelection: { authenticatorAttachment: "cross-platform" },
    });

    const refused = await client.post("/auth/passkeys/registration/verify", {
      challengeId: options.challengeId,
      response: authenticator("platform").register(options.options),
    });
    expect(refused.statusCode).toBe(400);
    expect(h.errorOf(refused).message).toMatch(/phone or a security key/);

    expect((await addPasskey(client, authenticator("cross-platform"))).statusCode).toBe(200);
  });

  it("rejects responses made for another site or with a used challenge", async () => {
    const { client } = await ownDevice("passkey-origin");
    const options = passkeyOptionsResponseSchema.parse(
      (await client.post("/auth/passkeys/registration/options")).json(),
    );
    const device = authenticator();
    const forged = await client.post("/auth/passkeys/registration/verify", {
      challengeId: options.challengeId,
      response: device.register(options.options, { origin: "https://evil.example" }),
    });
    expect(forged.statusCode).toBe(400);
    const replay = await client.post("/auth/passkeys/registration/verify", {
      challengeId: options.challengeId,
      response: device.register(options.options),
    });
    expect(replay.statusCode).toBe(400);
  });

  it("won't use a challenge issued to another session", async () => {
    const first = await ownDevice("passkey-challenge-a");
    const second = await ownDevice("passkey-challenge-b");
    const options = passkeyOptionsResponseSchema.parse(
      (await first.client.post("/auth/passkeys/registration/options")).json(),
    );
    const stolen = await second.client.post("/auth/passkeys/registration/verify", {
      challengeId: options.challengeId,
      response: authenticator().register(options.options),
    });
    expect(stolen.statusCode).toBe(400);
  });

  it("needs a recent sign-in", async () => {
    const { email, client } = await ownDevice("passkey-recent");
    await h.expireConfirmation(email);
    expect(h.errorOf(await client.post("/auth/passkeys/registration/options")).code).toBe(
      "reauthentication_required",
    );
  });
});

describe("signing in with a passkey", () => {
  it("signs in without a password or email address", async () => {
    const { email, client } = await ownDevice("passkey-signin");
    const device = authenticator();
    await addPasskey(client, device);

    const computer = h.browser();
    const { response } = await passkeySignIn(computer, device);
    expect(response.statusCode).toBe(200);
    const body = currentSessionResponseSchema.parse(response.json());
    expect(body.account.email).toBe(email);
    expect(body.session).toMatchObject({ persistent: false, authMethod: "passkey" });
    expect(computer.session).toBeDefined();
    expect((await computer.get("/auth/session")).statusCode).toBe(200);

    const passkeys = passkeyListSchema.parse((await client.get("/auth/passkeys")).json()).passkeys;
    expect(passkeys[0]?.lastUsedAt).not.toBeNull();
    expect(await h.eventTypes(email)).toContain("sign_in.succeeded");
  });

  it("refuses unknown passkeys, other sites and reused challenges", async () => {
    const { client } = await ownDevice("passkey-signin-refuse");
    const device = authenticator();
    await addPasskey(client, device);

    expect((await passkeySignIn(h.browser(), authenticator())).response.statusCode).toBe(401);
    expect(
      (await passkeySignIn(h.browser(), device, { origin: "https://evil.example" })).response
        .statusCode,
    ).toBe(401);

    const computer = h.browser();
    const { challengeId } = await passkeySignIn(computer, device);
    const options = { challenge: "irrelevant" };
    const reused = await computer.post("/auth/passkeys/authentication/verify", {
      challengeId,
      response: device.authenticate(options),
    });
    expect(reused.statusCode).toBe(401);
  });

  it("notices a cloned authenticator through its signature counter", async () => {
    const { client } = await ownDevice("passkey-clone");
    const device = authenticator("platform", false); // device-bound passkeys count signatures
    await addPasskey(client, device);
    expect((await passkeySignIn(h.browser(), device)).response.statusCode).toBe(200);
    expect((await passkeySignIn(h.browser(), device)).response.statusCode).toBe(200);
    device.rewindCounter();
    expect((await passkeySignIn(h.browser(), device)).response.statusCode).toBe(401);
  });
});

describe("managing passkeys", () => {
  it("renames, and removes after confirming it's you with a passkey", async () => {
    const { email, client } = await ownDevice("passkey-manage");
    const device = authenticator();
    const saved = (await addPasskey(client, device, "Old name")).json<{ id: string }>();

    const renamed = await client.patch(`/auth/passkeys/${saved.id}`, { name: "  Phone  " });
    expect(renamed.json()).toMatchObject({ name: "Phone" });

    await h.expireConfirmation(email);
    expect(h.errorOf(await client.delete(`/auth/passkeys/${saved.id}`)).code).toBe(
      "reauthentication_required",
    );

    const options = passkeyOptionsResponseSchema.parse(
      (await client.post("/auth/passkeys/confirmation/options")).json(),
    );
    expect(options.options).toMatchObject({ allowCredentials: [{ id: device.id }] });
    const confirmed = await client.post("/auth/passkeys/confirmation/verify", {
      challengeId: options.challengeId,
      response: device.authenticate(options.options),
    });
    expect(confirmed.statusCode).toBe(200);

    expect((await client.delete(`/auth/passkeys/${saved.id}`)).statusCode).toBe(204);
    expect(passkeyListSchema.parse((await client.get("/auth/passkeys")).json()).passkeys).toEqual(
      [],
    );
    expect(await h.waitForEmail(email, "A passkey was removed")).toContain("Phone");
    expect(await h.eventTypes(email)).toEqual(
      expect.arrayContaining(["reauthenticated", "passkey.removed"]),
    );
  });

  it("won't confirm with someone else's passkey or touch someone else's passkeys", async () => {
    const alice = await ownDevice("passkey-alice");
    const bob = await ownDevice("passkey-bob");
    const bobsDevice = authenticator();
    const bobsPasskey = (await addPasskey(bob.client, bobsDevice)).json<{ id: string }>();
    await addPasskey(alice.client, authenticator());

    const options = passkeyOptionsResponseSchema.parse(
      (await alice.client.post("/auth/passkeys/confirmation/options")).json(),
    );
    const wrongPerson = await alice.client.post("/auth/passkeys/confirmation/verify", {
      challengeId: options.challengeId,
      response: bobsDevice.authenticate(options.options),
    });
    expect(wrongPerson.statusCode).toBe(400);
    expect(
      (await alice.client.patch(`/auth/passkeys/${bobsPasskey.id}`, { name: "Mine now" }))
        .statusCode,
    ).toBe(404);
    expect((await alice.client.delete(`/auth/passkeys/${bobsPasskey.id}`)).statusCode).toBe(404);
  });

  it("explains when there is no passkey to confirm with", async () => {
    const { client } = await ownDevice("passkey-none");
    const response = await client.post("/auth/passkeys/confirmation/options");
    expect(response.statusCode).toBe(400);
    expect(h.errorOf(response).message).toMatch(/don’t have a passkey/);
  });
});
