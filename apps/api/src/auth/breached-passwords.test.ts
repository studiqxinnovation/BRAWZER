import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BreachedPasswordCheck, suffixInRange } from "./breached-passwords.js";

const sha1 = (value: string) => createHash("sha1").update(value).digest("hex").toUpperCase();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("suffixInRange", () => {
  it("finds a listed suffix and ignores padding entries", () => {
    const body = "0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0\n";
    expect(suffixInRange(body, "0018A45C4D1DEF81644B54AB7F969B88D65")).toBe(true);
    expect(suffixInRange(body, "00D4F6E8FA6EECAD2A3AA415EEC418D38EC")).toBe(false);
    expect(suffixInRange(body, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toBe(false);
  });
});

describe("BreachedPasswordCheck", () => {
  it("sends only the first 5 characters of the hash, with padding requested", async () => {
    const hash = sha1("correct horse battery staple");
    const fetchMock = vi.fn(() => Promise.resolve(new Response(`${hash.slice(5)}:12\n`)));
    vi.stubGlobal("fetch", fetchMock);
    const check = new BreachedPasswordCheck({ breachedPasswordCheck: true });

    expect(await check.isBreached("correct horse battery staple")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(url).not.toContain(hash.slice(5));
    expect(new Headers(init.headers).get("Add-Padding")).toBe("true");
  });

  it("reports a field-level validation error for a breached password", async () => {
    const hash = sha1("password-that-leaked");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(`${hash.slice(5)}:3`))),
    );
    await expect(
      new BreachedPasswordCheck({ breachedPasswordCheck: true }).assertNotBreached(
        "password-that-leaked",
        "newPassword",
      ),
    ).rejects.toMatchObject({
      code: "validation_failed",
      details: [expect.stringMatching(/^newPassword: /)],
    });
  });

  it("doesn't block anyone when the service is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    expect(await new BreachedPasswordCheck({ breachedPasswordCheck: true }).isBreached("x")).toBe(
      false,
    );
  });

  it("makes no request when switched off", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await new BreachedPasswordCheck({ breachedPasswordCheck: false }).isBreached("x")).toBe(
      false,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
