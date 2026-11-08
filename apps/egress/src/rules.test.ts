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
      await decideEgress("accounts.google.com", 443, {
        hasUpstream: true,
        allowPrivate: false,
        lookup,
      }),
    ).toEqual({ kind: "refused", reason: "engine" });
  });

  it("refuses ports a browser has no business with, before anything else", async () => {
    expect(
      await decideEgress("public.example", 25, { hasUpstream: false, allowPrivate: false, lookup }),
    ).toEqual({ kind: "refused", reason: "port" });
  });
});
