import type { SecurityEvent } from "@brawzer/contracts";
import {
  AppWindow,
  CircleUserRound,
  Globe,
  HardDriveDownload,
  House,
  Layers,
  type LucideIcon,
  MonitorSmartphone,
  Puzzle,
  ShieldCheck,
} from "lucide-react";
import type { Route } from "next";

export interface AppNavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** "planned" items lead to a page that explains when and how they'll be built. */
  status: "available" | "planned";
}

export interface AppNavGroup {
  label?: string;
  items: readonly AppNavItem[];
}

/** The signed-in navigation. Module names match the Product page. */
export const appNav: readonly AppNavGroup[] = [
  { items: [{ href: "/app", label: "Home", icon: House, status: "available" }] },
  {
    label: "Browse",
    items: [
      { href: "/app/browser", label: "Browser", icon: AppWindow, status: "planned" },
      { href: "/app/profiles", label: "Profiles", icon: Layers, status: "planned" },
      { href: "/app/drive", label: "Drive", icon: HardDriveDownload, status: "planned" },
      { href: "/app/proxy", label: "Proxy", icon: Globe, status: "planned" },
      { href: "/app/extensions", label: "Extensions", icon: Puzzle, status: "planned" },
    ],
  },
  {
    label: "Protect",
    items: [
      { href: "/app/shield", label: "Shield", icon: ShieldCheck, status: "available" },
      { href: "/app/sessions", label: "Sessions", icon: MonitorSmartphone, status: "available" },
    ],
  },
  {
    items: [{ href: "/app/account", label: "Account", icon: CircleUserRound, status: "available" }],
  },
];

export interface PlannedModule {
  title: string;
  lede: string;
  milestone: string;
  /** What the module will do, stated as plans, not as features that exist. */
  plans: readonly string[];
  /** The infrastructure that has to exist first, in plain words. */
  requires: readonly string[];
}

export const plannedModules = {
  browser: {
    title: "Browser",
    lede: "A real browser that runs in Brawzer’s cloud and appears in this page, with Brawzer’s own tabs, address bar and menus.",
    milestone: "Phase 3",
    plans: [
      "Chromium first, then Firefox, each running in its own isolated container per session.",
      "Tabs, bookmarks, history, downloads and keyboard shortcuts in Brawzer’s interface.",
      "Pages streamed as pixels: websites never run on the computer you’re using.",
    ],
    requires: [
      "Session gateway with single-use stream tickets that expire within 60 seconds",
      "Orchestrator that starts one container per session (Docker locally, Kubernetes later)",
      "Chromium runtime streamed over a secure WebSocket (3a), then WebRTC with a TURN server (3b)",
    ],
  },
  profiles: {
    title: "Profiles",
    lede: "Separate browsers for work, personal life, research and anything else. Each keeps its own cookies, history, extensions and proxy.",
    milestone: "Phase 2",
    plans: [
      "Create, rename, colour and delete profiles.",
      "Each profile’s browsing data is isolated from the others.",
      "Profiles live in your account, so they follow you to any computer.",
    ],
    requires: [
      "Profile records and API (Phase 2)",
      "Encrypted storage volume for each profile’s browser data (Phase 4)",
    ],
  },
  drive: {
    title: "Drive",
    lede: "Every download saved to your account in the cloud instead of the computer in front of you.",
    milestone: "Phase 4",
    plans: [
      "Downloads from the cloud browser land in Drive, scanned for malware.",
      "Previews, folders and search.",
      "Saving a file to this computer is a deliberate action that asks you to confirm it’s you.",
    ],
    requires: [
      "S3-compatible object storage (bucket and credentials, server-side only)",
      "Download interception in the browser runtime (Phase 3)",
      "A malware-scanning service",
    ],
  },
  proxy: {
    title: "Proxy",
    lede: "Route a profile’s traffic through a SOCKS5 or HTTP proxy of your choice, with live connection status.",
    milestone: "Phases 2 and 5",
    plans: [
      "SOCKS4, SOCKS5, HTTP and HTTPS proxies, with or without authentication.",
      "A different proxy for each profile, with a connection test before you use it.",
      "Proxy passwords are encrypted on Brawzer’s servers and never sent to the computer you’re using.",
    ],
    requires: [
      "Proxy settings API with envelope encryption through a key management service",
      "An egress-proxy sidecar beside each browser container (Phase 5)",
      "WebRTC and DNS leak prevention (Phase 5)",
    ],
  },
  extensions: {
    title: "Extensions",
    lede: "Supported browser extensions, installed separately for each profile.",
    milestone: "Phase 4",
    plans: [
      "Install extensions from a reviewed list into a single profile.",
      "Extensions run in the cloud browser, never on the computer you’re using.",
    ],
    requires: [
      "The cloud browser (Phase 3)",
      "Persistent, encrypted profiles (Phase 4)",
      "A reviewed extension catalogue",
    ],
  },
} as const satisfies Record<string, PlannedModule>;

export type EventTone = "neutral" | "success" | "warning";

/** What a security-history entry means, in plain words. */
export function describeEvent(event: Pick<SecurityEvent, "type" | "details">): {
  title: string;
  tone: EventTone;
} {
  const { details } = event;
  const count = details.count ?? 1;
  const devices = count === 1 ? "1 device" : `${String(count)} devices`;
  switch (event.type) {
    case "account.created":
      return { title: "Account created", tone: "neutral" };
    case "email.verified":
      return { title: "Email address confirmed", tone: "success" };
    case "sign_in.succeeded":
      return {
        title: details.persistent ? "Signed in, kept signed in on the device" : "Signed in",
        tone: "neutral",
      };
    case "sign_in.failed":
      return { title: "Failed sign-in: wrong password", tone: "warning" };
    case "sign_out":
      return { title: "Signed out", tone: "neutral" };
    case "session.refreshed":
      return { title: "Session renewed", tone: "neutral" };
    case "sessions.revoked":
      switch (details.reason) {
        case "password_reset":
          return { title: `Signed out ${devices} after a password reset`, tone: "neutral" };
        case "password_changed":
          return { title: `Signed out ${devices} after a password change`, tone: "neutral" };
        case "signed_out_everywhere_else":
          return { title: `Signed out ${devices} from Sessions`, tone: "neutral" };
        case "signed_out_remotely":
          return { title: "Signed out a device from Sessions", tone: "neutral" };
        default:
          return { title: `Signed out ${devices}`, tone: "neutral" };
      }
    case "password.reset_requested":
      return { title: "Password reset requested", tone: "neutral" };
    case "password.reset":
      return { title: "Password reset", tone: "success" };
    case "password.changed":
      return { title: "Password changed", tone: "success" };
    case "reauthenticated":
      return { title: "Confirmed it’s you", tone: "neutral" };
    case "passkey.added":
      return { title: "Passkey added", tone: "success" };
    case "passkey.removed":
      return { title: "Passkey removed", tone: "neutral" };
    case "mfa.enabled":
      return { title: "Two-factor authentication turned on", tone: "success" };
    case "mfa.disabled":
      return { title: "Two-factor authentication turned off", tone: "warning" };
    case "mfa.recovery_codes_regenerated":
      return { title: "New recovery codes created", tone: "neutral" };
    case "mfa.recovery_code_used":
      return { title: "Signed in with a recovery code", tone: "warning" };
    case "mfa.failed":
      return { title: "Wrong two-factor code entered", tone: "warning" };
    case "email.change_requested":
      return { title: "Email change requested", tone: "neutral" };
    case "email.changed":
      return { title: "Email address changed", tone: "success" };
    case "data.exported":
      return { title: "Account data downloaded", tone: "neutral" };
    case "profile.created":
      return { title: "Profile created", tone: "neutral" };
    case "profile.deleted":
      return { title: "Profile deleted", tone: "neutral" };
    case "proxy.created":
      return { title: "Proxy added", tone: "neutral" };
    case "proxy.updated":
      return { title: "Proxy changed", tone: "neutral" };
    case "proxy.deleted":
      return { title: "Proxy removed", tone: "neutral" };
    case "phone_sign_in.approved":
      return { title: "Approved a sign-in from your phone", tone: "neutral" };
    case "sign_in.new_device":
      return { title: "Signed in from a new device", tone: "warning" };
  }
}

/** How a device signed in, for the Sessions list. */
export const authMethodLabels = {
  password: "Signed in with a password",
  password_totp: "Signed in with a password and code",
  passkey: "Signed in with a passkey",
  phone: "Signed in with your phone",
  sign_up_link: "Signed in after confirming the email address",
} as const;
