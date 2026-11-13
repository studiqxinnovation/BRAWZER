import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The engines' managed policies, per session (ADR 0021). The image keeps the
 * locked policies under /opt/brawzer/policies and points the engines' policy
 * paths at the session's scratch space; the agent writes them there before
 * any engine starts, and won't start one if it can't.
 */
export const POLICY_SOURCE_DIR = "/opt/brawzer/policies";

type Policies = Record<string, unknown>;

/** Chromium and Chrome: the password manager, and Chrome's own sign-in and sync, when asked for. */
export function chromiumPolicies(base: Policies, browserAccount: boolean): Policies {
  if (!browserAccount) return base;
  return {
    ...base,
    PasswordManagerEnabled: true,
    SyncDisabled: false,
    BrowserSignin: 1,
    SigninAllowed: true,
    // The browser's own pages a person needs for this, and no others.
    URLAllowlist: ["chrome://password-manager", "chrome://settings"],
  };
}

/**
 * Microsoft Edge reads Chromium's policies, under its own path, and has more
 * of its own: no first-run screens, no shopping, rewards or sidebar, no
 * diagnostic data, and its edge:// pages refused like chrome:// ones, apart
 * from its passwords and sign-in when the profile's account is on.
 */
export function edgePolicies(base: Policies, browserAccount: boolean): Policies {
  const chromium = chromiumPolicies(base, browserAccount);
  const blocked = Array.isArray(chromium.URLBlocklist) ? (chromium.URLBlocklist as string[]) : [];
  return {
    ...chromium,
    URLBlocklist: [...blocked, "edge://*"],
    ...(browserAccount ? { URLAllowlist: ["edge://wallet", "edge://settings"] } : {}),
    HideFirstRunExperience: true,
    ImplicitSignInEnabled: false,
    DiagnosticData: 0,
    PersonalizationReportingEnabled: false,
    ShowRecommendationsEnabled: false,
    EdgeShoppingAssistantEnabled: false,
    ShowMicrosoftRewards: false,
    HubsSidebarEnabled: false,
    StartupBoostEnabled: false,
    SmartScreenEnabled: false,
    EdgeCollectionsEnabled: false,
    NewTabPageContentEnabled: false,
    SpotlightExperiencesAndRecommendationsEnabled: false,
  };
}

/** Firefox: the password manager, and signing in to a Mozilla account for Sync, when asked for. */
export function firefoxPolicies(base: { policies: Policies }, browserAccount: boolean) {
  if (!browserAccount) return base;
  return {
    policies: {
      ...base.policies,
      DisableFirefoxAccounts: false,
      PasswordManagerEnabled: true,
      OfferToSaveLogins: true,
    },
  };
}

/** Writes every engine's policies for this session; throws (so nothing starts) if it can't. */
export function writePolicies(options: {
  scratchDir: string;
  browserAccount: boolean;
  sourceDir?: string;
}): void {
  const source = options.sourceDir ?? POLICY_SOURCE_DIR;
  const target = path.join(options.scratchDir, "brawzer-policy");
  mkdirSync(target, { recursive: true, mode: 0o755 });
  const chromium = JSON.parse(readFileSync(path.join(source, "chromium.json"), "utf8")) as Policies;
  const firefox = JSON.parse(readFileSync(path.join(source, "firefox.json"), "utf8")) as {
    policies: Policies;
  };
  writeFileSync(
    path.join(target, "chromium.json"),
    JSON.stringify(chromiumPolicies(chromium, options.browserAccount)),
    { mode: 0o444 },
  );
  writeFileSync(
    path.join(target, "edge.json"),
    JSON.stringify(edgePolicies(chromium, options.browserAccount)),
    { mode: 0o444 },
  );
  writeFileSync(
    path.join(target, "firefox.json"),
    JSON.stringify(firefoxPolicies(firefox, options.browserAccount)),
    { mode: 0o444 },
  );
}
