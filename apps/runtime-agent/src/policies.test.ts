import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumPolicies, edgePolicies, firefoxPolicies, writePolicies } from "./policies.ts";

const repoPolicies = path.join(import.meta.dirname, "..");

describe("per-session policies", () => {
  it("keep everything locked unless the profile has its browser account on", () => {
    const base = JSON.parse(
      readFileSync(path.join(repoPolicies, "policies.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(chromiumPolicies(base, false)).toBe(base);
    expect(base).toMatchObject({
      PasswordManagerEnabled: false,
      SyncDisabled: true,
      BrowserSignin: 0,
    });
    const open = chromiumPolicies(base, true);
    expect(open).toMatchObject({
      PasswordManagerEnabled: true,
      SyncDisabled: false,
      BrowserSignin: 1,
      URLAllowlist: ["chrome://password-manager", "chrome://settings"],
    });
    // The rest stays as it was: the proxy, the refusals, the blocked schemes.
    expect(open.ProxyServer).toBe(base.ProxyServer);
    expect(open.URLBlocklist).toEqual(base.URLBlocklist);
    expect(open.DownloadRestrictions).toBe(base.DownloadRestrictions);

    // Edge: the same, its own pages refused too, and its own extras off.
    const edge = edgePolicies(base, false);
    expect(edge.URLBlocklist).toEqual([...(base.URLBlocklist as string[]), "edge://*"]);
    expect(edge).toMatchObject({
      PasswordManagerEnabled: false,
      BrowserSignin: 0,
      HideFirstRunExperience: true,
      DiagnosticData: 0,
      EdgeShoppingAssistantEnabled: false,
    });
    expect(edge.URLAllowlist).toBeUndefined();
    expect(edgePolicies(base, true)).toMatchObject({
      PasswordManagerEnabled: true,
      BrowserSignin: 1,
      URLAllowlist: ["edge://wallet", "edge://settings"],
    });

    const firefox = JSON.parse(
      readFileSync(path.join(repoPolicies, "policies-firefox.json"), "utf8"),
    ) as { policies: Record<string, unknown> };
    expect(firefoxPolicies(firefox, false)).toBe(firefox);
    expect(firefoxPolicies(firefox, true).policies).toMatchObject({
      DisableFirefoxAccounts: false,
      PasswordManagerEnabled: true,
      DisableTelemetry: true,
    });
  });

  it("writes every engine's file where the image's policy paths point", () => {
    const source = mkdtempSync(path.join(tmpdir(), "policies-source-"));
    writeFileSync(path.join(source, "chromium.json"), JSON.stringify({ SyncDisabled: true }));
    writeFileSync(
      path.join(source, "firefox.json"),
      JSON.stringify({ policies: { DisableFirefoxAccounts: true } }),
    );
    const scratch = mkdtempSync(path.join(tmpdir(), "policies-scratch-"));
    writePolicies({ scratchDir: scratch, browserAccount: true, sourceDir: source });
    expect(
      JSON.parse(readFileSync(path.join(scratch, "brawzer-policy", "chromium.json"), "utf8")),
    ).toMatchObject({
      SyncDisabled: false,
    });
    expect(
      JSON.parse(readFileSync(path.join(scratch, "brawzer-policy", "edge.json"), "utf8")),
    ).toMatchObject({ SyncDisabled: false, HideFirstRunExperience: true });
    expect(
      JSON.parse(readFileSync(path.join(scratch, "brawzer-policy", "firefox.json"), "utf8")),
    ).toEqual({
      policies: {
        DisableFirefoxAccounts: false,
        PasswordManagerEnabled: true,
        OfferToSaveLogins: true,
      },
    });
    // Without the source files nothing is written, and the caller doesn't start an engine.
    expect(() =>
      writePolicies({
        scratchDir: scratch,
        browserAccount: false,
        sourceDir: path.join(source, "missing"),
      }),
    ).toThrow();
  });
});
