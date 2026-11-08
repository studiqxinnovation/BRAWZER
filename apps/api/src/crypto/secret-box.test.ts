import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalKeyProvider, VaultTransitKeyProvider } from "./key-providers.js";
import { SecretBox } from "./secret-box.js";

const key = (id: string) => ({ id, key: randomBytes(32) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SecretBox with local keys", () => {
  const current = key("local-2");
  const box = new SecretBox(new LocalKeyProvider([current]));

  it("round-trips a secret, with a fresh data key every time", async () => {
    const first = await box.seal("JBSWY3DPEHPK3PXP", "totp:user-1");
    const second = await box.seal("JBSWY3DPEHPK3PXP", "totp:user-1");
    expect(first).not.toBe(second);
    expect(first).not.toContain("JBSWY3DPEHPK3PXP");
    expect(first.startsWith("v1.local-2.")).toBe(true);
    expect(await box.open(first, "totp:user-1")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("re-wraps a secret under the current key after a rotation, and only then", async () => {
    const old = key("local-1");
    const sealedBefore = await new SecretBox(new LocalKeyProvider([old])).seal("s3cret", "proxy:a");
    expect(await new SecretBox(new LocalKeyProvider([old])).rewrap(sealedBefore)).toBeNull();
    // Rotation: a new first key, the old one still readable.
    const rotated = new SecretBox(new LocalKeyProvider([current, old]));
    const rewrapped = await rotated.rewrap(sealedBefore);
    expect(rewrapped).not.toBeNull();
    expect(rewrapped?.startsWith("v1.local-2.")).toBe(true);
    expect(rewrapped?.split(".").slice(3)).toEqual(sealedBefore.split(".").slice(3));
    expect(await rotated.open(rewrapped ?? "", "proxy:a")).toBe("s3cret");
    // Once every row is re-wrapped the old key can go.
    expect(await box.open(rewrapped ?? "", "proxy:a")).toBe("s3cret");
    await expect(box.open(sealedBefore, "proxy:a")).rejects.toThrow();
  });

  it("refuses a sealed value copied onto another record", async () => {
    const sealed = await box.seal("proxy-password", "proxy:a");
    await expect(box.open(sealed, "proxy:b")).rejects.toThrow();
  });

  it("detects tampering", async () => {
    const sealed = await box.seal("proxy-password", "proxy:a");
    const parts = sealed.split(".");
    const ciphertext = Buffer.from(parts[4] ?? "", "base64url");
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    parts[4] = ciphertext.toString("base64url");
    await expect(box.open(parts.join("."), "proxy:a")).rejects.toThrow();
    await expect(box.open("not-sealed", "proxy:a")).rejects.toThrow("Not a sealed secret");
  });

  it("still opens values sealed with an older key after rotation", async () => {
    const old = key("local-1");
    const sealedWithOld = await new SecretBox(new LocalKeyProvider([old])).seal("s3cret", "ctx");
    const rotated = new SecretBox(new LocalKeyProvider([current, old]));
    expect(await rotated.open(sealedWithOld, "ctx")).toBe("s3cret");
    expect(SecretBox.keyIdOf(await rotated.seal("s3cret", "ctx"))).toBe("local-2");
  });

  it("rejects values sealed with a key it doesn't have", async () => {
    const sealed = await new SecretBox(new LocalKeyProvider([key("other")])).seal("x", "ctx");
    await expect(box.open(sealed, "ctx")).rejects.toThrow('Unknown key ID "other"');
  });
});

describe("VaultTransitKeyProvider", () => {
  it("asks the key service for data keys and to unwrap them, with its token", async () => {
    const dataKey = randomBytes(32);
    const fetchMock = vi.fn((url: string | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: String(url).includes("/datakey/")
              ? { plaintext: dataKey.toString("base64"), ciphertext: "vault:v1:wrapped" }
              : { plaintext: dataKey.toString("base64") },
          }),
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VaultTransitKeyProvider({
      address: "https://vault.internal:8200",
      token: "t0ken",
      mount: "transit",
      keyName: "brawzer",
    });
    const box = new SecretBox(provider);

    const sealed = await box.seal("hello", "ctx");
    expect(SecretBox.keyIdOf(sealed)).toBe("transit-brawzer");
    expect(await box.open(sealed, "ctx")).toBe("hello");

    const [generateUrl, generateInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(generateUrl)).toBe(
      "https://vault.internal:8200/v1/transit/datakey/plaintext/brawzer",
    );
    expect(new Headers(generateInit.headers).get("X-Vault-Token")).toBe("t0ken");
    const [unwrapUrl, unwrapInit] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit];
    expect(String(unwrapUrl)).toBe("https://vault.internal:8200/v1/transit/decrypt/brawzer");
    expect(JSON.parse(unwrapInit.body as string)).toEqual({ ciphertext: "vault:v1:wrapped" });
  });

  it("reports key-service errors without key material", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ errors: ["permission denied"] }), { status: 403 }),
        ),
      ),
    );
    const provider = new VaultTransitKeyProvider({
      address: "https://v",
      token: "t",
      mount: "transit",
      keyName: "k",
    });
    await expect(provider.generateDataKey()).rejects.toThrow(
      "Key service responded 403: permission denied",
    );
  });
});
