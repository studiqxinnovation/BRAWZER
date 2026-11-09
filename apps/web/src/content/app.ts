import type { Recommendation, SecurityEvent } from "@brawzer/contracts";
import {
  AppWindow,
  CircleUserRound,
  Globe,
  HardDriveDownload,
  House,
  Layers,
  type LucideIcon,
  ListFilter,
  MonitorSmartphone,
  Puzzle,
  ShieldCheck,
  ShieldEllipsis,
  Users,
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
      { href: "/app/extensions", label: "Extensions", icon: Puzzle, status: "available" },
    ],
  },
  {
    label: "Protect",
    items: [
      { href: "/app/shield", label: "Shield", icon: ShieldCheck, status: "available" },
      { href: "/app/site-rules", label: "Site rules", icon: ListFilter, status: "available" },
      { href: "/app/sessions", label: "Sessions", icon: MonitorSmartphone, status: "available" },
    ],
  },
  {
    items: [
      { href: "/app/team", label: "Team", icon: Users, status: "available" },
      { href: "/app/account", label: "Account", icon: CircleUserRound, status: "available" },
    ],
  },
];

/** Shown to administrators only (the API decides who those are). */
export const adminNav: AppNavGroup = {
  label: "Administration",
  items: [{ href: "/app/admin", label: "Admin", icon: ShieldEllipsis, status: "available" }],
};

export interface PlannedModule {
  title: string;
  lede: string;
  milestone: string;
  /** What the module will do, stated as plans, not as features that exist. */
  plans: readonly string[];
  /** The infrastructure that has to exist first, in plain words. */
  requires: readonly string[];
}

/** Every module is built; the shape stays for the next one that isn't. */
export const plannedModules: Readonly<Record<string, PlannedModule>> = {};

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
    case "profile.history_cleared":
      return { title: "A profile’s history was cleared", tone: "neutral" };
    case "profile.data_cleared":
      return { title: "A profile’s browsing data was cleared", tone: "neutral" };
    case "billing.subscription_started":
      return { title: `Subscription started: ${details.plan ?? "a paid plan"}`, tone: "neutral" };
    case "billing.subscription_changed":
      return {
        title: `Subscription changed to ${details.plan ?? "another plan"}`,
        tone: "neutral",
      };
    case "billing.subscription_ended":
      return { title: "Subscription ended; back on the free plan", tone: "neutral" };
    case "admin.plan_changed":
      return {
        title: `Plan set to ${details.plan ?? "another plan"} by Brawzer${details.reason ? `: ${details.reason}` : ""}`,
        tone: "neutral",
      };
    case "browser.file_saved":
      return {
        title:
          details.kind === "print"
            ? "Page saved as a PDF to Drive from the cloud browser"
            : "File downloaded to Drive by the cloud browser",
        tone: "neutral",
      };
    case "browser.file_sent":
      return {
        title:
          details.count === 1
            ? "A Drive file was given to a website in the cloud browser"
            : `${String(details.count ?? 0)} Drive files were given to a website in the cloud browser`,
        tone: "neutral",
      };
    case "browser.clipboard_copied":
      return {
        title: `${String(details.chars ?? 0)} characters copied from the cloud browser to a computer’s clipboard`,
        tone: "neutral",
      };
    case "team.created":
      return { title: `Team started: ${details.team ?? "a team"}`, tone: "neutral" };
    case "team.joined":
      return { title: `Joined ${details.team ?? "a team"}`, tone: "neutral" };
    case "team.left":
      return { title: `Left ${details.team ?? "the team"}`, tone: "neutral" };
    case "team.member_removed":
      return {
        title: `Removed from ${details.team ?? "the team"} by its owner or an admin`,
        tone: "warning",
      };
    case "team.role_changed":
      return {
        title: `Made ${details.role === "admin" ? "an admin" : "a member"} of ${details.team ?? "the team"}`,
        tone: "neutral",
      };
    case "team.ownership_transferred":
      return {
        title:
          details.role === "owner"
            ? `Became the owner of ${details.team ?? "the team"}`
            : `Handed ${details.team ?? "the team"} to another member`,
        tone: "neutral",
      };
    case "team.deleted":
      return { title: `${details.team ?? "The team"} was deleted`, tone: "neutral" };
    case "team.invitation_sent":
      return {
        title: `Invited someone to ${details.team ?? "the team"} as ${details.role === "admin" ? "an admin" : "a member"}`,
        tone: "neutral",
      };
    case "browser.page_reported":
      return {
        title: details.picture
          ? "A page was reported to Brawzer, with a picture of it"
          : "A page was reported to Brawzer",
        tone: "neutral",
      };
    case "browser.clipboard_pasted":
      return {
        title: `${String(details.chars ?? 0)} characters pasted from a computer’s clipboard into the cloud browser`,
        tone: "neutral",
      };
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
        case "admin":
          return {
            title: "Cloud browser session ended by Brawzer’s administrators",
            tone: "warning",
          };
        case "handed_off":
          return {
            title: "Cloud browser session ended to continue on another device",
            tone: "neutral",
          };
        case "team_left":
          return {
            title: "Cloud browser session ended: it used a team proxy you no longer have",
            tone: "neutral",
          };
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
