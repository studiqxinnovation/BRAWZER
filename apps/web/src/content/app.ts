import type { Recommendation, SecurityEvent } from "@brawzer/contracts";
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
      { href: "/app/browser", label: "Browser", icon: AppWindow, status: "available" },
      { href: "/app/profiles", label: "Profiles", icon: Layers, status: "available" },
      { href: "/app/drive", label: "Drive", icon: HardDriveDownload, status: "available" },
      { href: "/app/proxy", label: "Proxy", icon: Globe, status: "available" },
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
  extensions: {
    title: "Extensions",
    lede: "Supported browser extensions, installed separately for each profile.",
    milestone: "Phase 4",
    plans: [
      "Install extensions from a reviewed list into a single profile.",
      "Extensions run in the cloud browser, never on the computer you’re using.",
    ],
    requires: [
      "Persistent, encrypted profiles (planned after Phase 3)",
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
        case "email_change_undone":
          return { title: `Signed out ${devices} after undoing an email change`, tone: "neutral" };
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
    case "email.change_undone":
      return { title: "Email change undone, new password set", tone: "success" };
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
    case "browser.session_started":
      return { title: "Cloud browser session started", tone: "neutral" };
    case "browser.session_ended":
      switch (details.reason) {
        case "idle":
          return {
            title: "Cloud browser session ended after 15 minutes unwatched",
            tone: "neutral",
          };
        case "max_lifetime":
          return { title: "Cloud browser session ended after 4 hours", tone: "neutral" };
        case "signed_out":
          return { title: "Cloud browser session ended with the sign-out", tone: "neutral" };
        case "runtime_failed":
          return { title: "Cloud browser session stopped unexpectedly", tone: "warning" };
        default:
          return { title: "Cloud browser session ended", tone: "neutral" };
      }
    case "drive.file_uploaded":
      return { title: "File uploaded to Drive", tone: "neutral" };
    case "drive.file_quarantined":
      return { title: "Uploaded file quarantined: malware found", tone: "warning" };
    case "drive.file_deleted":
      return { title: "File deleted from Drive", tone: "neutral" };
    case "drive.file_saved":
      return {
        title:
          details.persistent === false
            ? "File saved to a shared computer from Drive"
            : "File saved to a computer from Drive",
        tone: "neutral",
      };
    case "drive.folder_deleted":
      return {
        title:
          count === 0
            ? "Folder deleted from Drive"
            : `Folder deleted from Drive with ${count === 1 ? "1 file" : `${String(count)} files`}`,
        tone: "neutral",
      };
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

/** What Shield suggests, and where to do it. */
export const recommendationContent: Record<
  Recommendation["id"],
  { title: string; body: string; href: Route; action: string }
> = {
  add_passkey: {
    title: "Add a passkey",
    body: "Sign in with your phone, face, fingerprint or a security key. A passkey works only on Brawzer’s real site, so a fake sign-in page can’t use it.",
    href: "/app/account#passkeys-heading",
    action: "Add a passkey",
  },
  enable_two_factor: {
    title: "Turn on two-factor authentication",
    body: "Ask for a code from an authenticator app after your password, so a stolen password isn’t enough on its own.",
    href: "/app/account#two-factor-heading",
    action: "Set up two-factor",
  },
  recovery_codes_low: {
    title: "You’re running out of recovery codes",
    body: "Create a new set, so you can still sign in if you lose your authenticator.",
    href: "/app/account#two-factor-heading",
    action: "Create new codes",
  },
  review_devices: {
    title: "Review your signed-in devices",
    body: "Your account is signed in on several devices. Sign out any you don’t recognise or no longer use.",
    href: "/app/sessions",
    action: "Review sessions",
  },
};
