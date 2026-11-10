import { describe, expect, it } from "vitest";
import { decideEgress, isAllowedPort, isEngineHost } from "./rules.ts";

const lookup = (name: string) =>
  Promise.resolve(
    name === "public.example"
      ? [{ address: "93.184.216.34", family: 4 }]
      : name === "rebinding.example"
        ? [
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.5", family: 4 },
          ]
        : [],
  );

describe("egress rules", () => {
  it("allows the web's ports and the unprivileged range only", () => {
    expect(isAllowedPort(80)).toBe(true);
    expect(isAllowedPort(443)).toBe(true);
    expect(isAllowedPort(8443)).toBe(true);
    for (const port of [22, 25, 53, 445, 0, 70000])
      expect(isAllowedPort(port), String(port)).toBe(false);
  });

  it("resolves names itself without a saved proxy and refuses private answers", async () => {
    const direct = { hasUpstream: false, allowPrivate: false, lookup };
    expect(await decideEgress("public.example", 443, direct)).toEqual({
      kind: "direct",
      address: "93.184.216.34",
      port: 443,
    });
    expect(await decideEgress("rebinding.example", 443, direct)).toEqual({
      kind: "refused",
      reason: "address",
    });
    expect(await decideEgress("nowhere.example", 443, direct)).toEqual({
      kind: "refused",
      reason: "unresolved",
    });
    expect(await decideEgress("10.0.0.5", 443, direct)).toEqual({
      kind: "refused",
      reason: "address",
    });
    expect(await decideEgress("localhost", 443, direct)).toEqual({
      kind: "refused",
      reason: "address",
    });
    expect(await decideEgress("169.254.169.254", 80, direct)).toEqual({
      kind: "refused",
      reason: "address",
    });
  });

  it("hands names to a saved proxy unresolved, still refusing the obviously local", async () => {
    const viaProxy = { hasUpstream: true, allowPrivate: false, lookup };
    expect(await decideEgress("nowhere.example", 443, viaProxy)).toEqual({
      kind: "upstream",
      host: "nowhere.example",
      port: 443,
    });
    expect(await decideEgress("192.168.1.1", 80, viaProxy)).toEqual({
      kind: "refused",
      reason: "address",
    });
    expect(await decideEgress("printer.local", 80, viaProxy)).toEqual({
      kind: "refused",
      reason: "address",
    });
  });

  it("refuses the engine's own services by suffix", async () => {
    expect(isEngineHost("update.googleapis.com")).toBe(true);
    expect(isEngineHost("foo.clients2.google.com")).toBe(true);
    expect(isEngineHost("www.google.com")).toBe(false);
    expect(
      await decideEgress("safebrowsing.googleapis.com", 443, {
        hasUpstream: true,
        allowPrivate: false,
        lookup,
      }),
    ).toEqual({ kind: "refused", reason: "engine" });
  });

  it("lets a profile with its browser account on reach Chrome's sync, and nothing more", async () => {
    const options = { hasUpstream: true, allowPrivate: false, lookup };
    expect(await decideEgress("clients4.google.com", 443, options)).toEqual({
      kind: "refused",
      reason: "engine",
    });
    expect(
      await decideEgress("clients4.google.com", 443, { ...options, accountSync: true }),
    ).toEqual({ kind: "upstream", host: "clients4.google.com", port: 443 });
    expect(
      await decideEgress("update.googleapis.com", 443, { ...options, accountSync: true }),
    ).toEqual({ kind: "refused", reason: "engine" });
  });

  it("lets pages sign in to Google and load what its sites need", () => {
    for (const host of [
      "accounts.google.com",
      "www.gstatic.com",
      "ssl.gstatic.com",
      "clients6.google.com",
      "dl.google.com",
      "passwords.google.com",
      "myaccount.google.com",
    ]) {
      expect(isEngineHost(host), host).toBe(false);
    }
  });

  it("refuses ports a browser has no business with, before anything else", async () => {
    expect(
      await decideEgress("public.example", 25, { hasUpstream: false, allowPrivate: false, lookup }),
    ).toEqual({ kind: "refused", reason: "port" });
  });

  it("hands private addresses to the proxy only when the profile asked, never loopback", async () => {
    const base = { hasUpstream: true, allowPrivate: false, lookup };
    expect(await decideEgress("10.0.0.5", 80, base)).toEqual({
      kind: "refused",
      reason: "address",
    });
    expect(await decideEgress("intranet.local", 80, base)).toEqual({
      kind: "refused",
      reason: "address",
    });
    const intranet = { ...base, privateViaUpstream: true };
    expect(await decideEgress("10.0.0.5", 80, intranet)).toEqual({
      kind: "upstream",
      host: "10.0.0.5",
      port: 80,
    });
    expect(await decideEgress("intranet.local", 443, intranet)).toEqual({
      kind: "upstream",
      host: "intranet.local",
      port: 443,
    });
    for (const host of ["127.0.0.1", "::1", "localhost", "app.localhost"]) {
      expect(await decideEgress(host, 80, intranet), host).toEqual({
        kind: "refused",
        reason: "address",
      });
    }
    // Without a proxy the switch means nothing: there is no one to hand the address to.
    expect(
      await decideEgress("10.0.0.5", 80, {
        hasUpstream: false,
        allowPrivate: false,
        privateViaUpstream: true,
        lookup,
      }),
    ).toEqual({ kind: "refused", reason: "address" });
  });

  it("applies the account's site rules first: blocked never, allowed only when any are listed", async () => {
    const base = { hasUpstream: false, allowPrivate: false, lookup };
    const blocked = { ...base, siteRules: { allow: [], block: ["public.example"] } };
    expect(await decideEgress("public.example", 443, blocked)).toEqual({
      kind: "refused",
      reason: "policy",
    });
    expect(await decideEgress("WWW.Public.example", 443, blocked)).toEqual({
      kind: "refused",
      reason: "policy",
    });
    expect(await decideEgress("notpublic.example", 443, blocked)).toEqual({
      kind: "refused",
      reason: "unresolved",
    });
    const onlySome = { ...base, siteRules: { allow: ["public.example"], block: [] } };
    expect(await decideEgress("public.example", 443, onlySome)).toMatchObject({ kind: "direct" });
    expect(await decideEgress("rebinding.example", 443, onlySome)).toEqual({
      kind: "refused",
      reason: "policy",
    });
    // Block wins over allow, and an address can be a rule too.
    const both = { ...base, siteRules: { allow: ["public.example"], block: ["public.example"] } };
    expect(await decideEgress("public.example", 443, both)).toEqual({
      kind: "refused",
      reason: "policy",
    });
    expect(
      await decideEgress("93.184.216.34", 443, {
        ...base,
        siteRules: { allow: [], block: ["93.184.216.34"] },
      }),
    ).toEqual({ kind: "refused", reason: "policy" });
  });
});
