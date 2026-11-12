/**
 * Transactional email templates. Each returns a subject, a plain-text body
 * and an HTML body with inline styles (email clients ignore stylesheets).
 * Every interpolated value is escaped.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

/**
 * Where the mark shown at the top of each email lives (set once by the
 * service from the web app's address). Clients that block images still see
 * the "Brawzer" wordmark beside it.
 */
let markUrl: string | null = null;
export function setMarkUrl(url: string | null): void {
  markUrl = url;
}

interface LayoutOptions {
  preheader: string;
  heading: string;
  paragraphs: readonly string[];
  action?: { label: string; url: string };
  /** Short facts in a table, such as a plan and when it renews. */
  facts?: readonly (readonly [string, string])[];
  footnote: string;
  /** For an optional notice: why the person gets it, and the link that stops it. */
  unsubscribe?: { reason: string; url: string };
}

function renderHtml({
  preheader,
  heading,
  paragraphs,
  action,
  facts,
  footnote,
  unsubscribe,
}: LayoutOptions): string {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const body = paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#5e5b56;">${escapeHtml(text)}</p>`,
    )
    .join("");
  const table =
    facts && facts.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border:1px solid #e4e2dd;border-radius:10px;">${facts
          .map(
            ([label, value], index) =>
              `<tr><td style="padding:10px 14px;font-size:13px;color:#6f6b65;${index > 0 ? "border-top:1px solid #eeece8;" : ""}">${escapeHtml(label)}</td><td align="right" style="padding:10px 14px;font-size:13px;font-weight:600;color:#1c1b19;${index > 0 ? "border-top:1px solid #eeece8;" : ""}">${escapeHtml(value)}</td></tr>`,
          )
          .join("")}</table>`
      : "";
  const button = action
    ? `<p style="margin:24px 0 20px;"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#2b5be0;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;line-height:20px;padding:12px 20px;border-radius:8px;">${escapeHtml(action.label)}</a></p>
<p style="margin:0;font-size:13px;line-height:18px;color:#6f6b65;">Or copy this link into your browser:<br><span style="word-break:break-all;color:#2453cf;">${escapeHtml(action.url)}</span></p>`
    : "";
  const mark = markUrl
    ? `<img src="${escapeHtml(markUrl)}" width="28" height="28" alt="" style="display:inline-block;vertical-align:middle;border-radius:7px;margin-right:10px;">`
    : "";
  const stop = unsubscribe
    ? `<p style="margin:10px 0 0;font-size:12px;line-height:18px;color:#6f6b65;">${escapeHtml(unsubscribe.reason)} <a href="${escapeHtml(unsubscribe.url)}" style="color:#2453cf;">Stop these emails</a>.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f8f7f4;font-family:${font};color:#1c1b19;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f4;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td style="padding:0 4px 20px;font-size:18px;font-weight:600;letter-spacing:-0.02em;color:#1c1b19;">${mark}<span style="vertical-align:middle;">Brawzer</span></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e2dd;border-radius:16px;padding:32px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.01em;color:#1c1b19;">${escapeHtml(heading)}</h1>
${body}${table}${button}
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:18px;color:#6f6b65;">${escapeHtml(footnote)}${stop}
<p style="margin:14px 0 0;font-size:12px;line-height:18px;color:#9a968f;">Brawzer · Your computer in the cloud. Nothing is saved on your device.</p></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderText({
  heading,
  paragraphs,
  action,
  facts,
  footnote,
  unsubscribe,
}: LayoutOptions): string {
  return [
    heading,
    "",
    ...paragraphs.flatMap((text) => [text, ""]),
    ...(facts && facts.length > 0
      ? [...facts.map(([label, value]) => `${label}: ${value}`), ""]
      : []),
    ...(action ? [`${action.label}: ${action.url}`, ""] : []),
    footnote,
    ...(unsubscribe ? ["", `${unsubscribe.reason} Stop these emails: ${unsubscribe.url}`] : []),
    "",
    "Brawzer · Your computer in the cloud. Nothing is saved on your device.",
  ].join("\n");
}

function compose(subject: string, options: LayoutOptions): EmailContent {
  return { subject, text: renderText(options), html: renderHtml(options) };
}

export function verifyEmailMessage(url: string): EmailContent {
  return compose("Confirm your email for Brawzer", {
    preheader: "Confirm this address to finish creating your Brawzer account.",
    heading: "Confirm your email",
    paragraphs: [
      "Confirm this address to finish creating your Brawzer account.",
      "You’ll be asked for the password you chose, so only you can finish. The link works once and expires in 24 hours.",
    ],
    action: { label: "Confirm email", url },
    footnote:
      "If you didn’t create a Brawzer account, ignore this email. Without your password, nobody can finish creating it.",
  });
}

export function resetPasswordMessage(url: string): EmailContent {
  return compose("Reset your Brawzer password", {
    preheader: "Choose a new password for your Brawzer account.",
    heading: "Reset your password",
    paragraphs: [
      "Someone asked to reset the password for your Brawzer account. If it was you, choose a new password.",
      "The link works once and expires in 30 minutes. Resetting signs you out on every device.",
    ],
    action: { label: "Choose a new password", url },
    footnote: "If you didn’t ask for this, ignore this email. Your password won’t change.",
  });
}

export function accountExistsMessage(signInUrl: string): EmailContent {
  return compose("Someone tried to create a Brawzer account with your email", {
    preheader: "You already have a Brawzer account.",
    heading: "You already have an account",
    paragraphs: [
      "Someone tried to create a new Brawzer account with this email address, but it already belongs to your account.",
      "If it was you, sign in instead. If you’ve forgotten your password, you can reset it from the sign-in page.",
    ],
    action: { label: "Sign in", url: signInUrl },
    footnote:
      "If it wasn’t you, you don’t need to do anything. Nobody can use your account without your password.",
  });
}

/** Who was signed out: after a reset every device; after a change, every device but the one used. */
export type SignedOutScope = "every-device" | "other-devices";

export function passwordChangedMessage(
  when: string,
  device: string | null,
  scope: SignedOutScope,
): EmailContent {
  return compose("Your Brawzer password was changed", {
    preheader:
      scope === "every-device"
        ? "Your password was changed and every device was signed out."
        : "Your password was changed and your other devices were signed out.",
    heading: "Your password was changed",
    paragraphs: [
      `Your Brawzer password was changed on ${when}${device ? ` from ${device}` : ""}.`,
      scope === "every-device"
        ? "For your security, every device that was signed in has been signed out."
        : "For your security, every other device that was signed in has been signed out.",
    ],
    footnote: "If you didn’t do this, reset your password straight away from the sign-in page.",
  });
}

export function passkeyAddedMessage(
  name: string,
  when: string,
  device: string | null,
): EmailContent {
  return compose("A passkey was added to your Brawzer account", {
    preheader: `The passkey "${name}" can now sign in to your account.`,
    heading: "A passkey was added",
    paragraphs: [
      `The passkey "${name}" was added to your Brawzer account on ${when}${device ? ` from ${device}` : ""}. It can now sign in without a password.`,
    ],
    footnote:
      "If you didn’t add it, sign in, remove it under Account, change your password and sign out other devices in Sessions.",
  });
}

export function passkeyRemovedMessage(name: string, when: string): EmailContent {
  return compose("A passkey was removed from your Brawzer account", {
    preheader: `The passkey "${name}" can no longer sign in.`,
    heading: "A passkey was removed",
    paragraphs: [`The passkey "${name}" was removed from your Brawzer account on ${when}.`],
    footnote: "If you didn’t remove it, change your password and review Sessions.",
  });
}

export function mfaEnabledMessage(when: string): EmailContent {
  return compose("Two-factor authentication is on for your Brawzer account", {
    preheader: "Signing in with your password now also needs a code.",
    heading: "Two-factor authentication is on",
    paragraphs: [
      `Two-factor authentication was turned on for your Brawzer account on ${when}. Signing in with your password now also needs a code from your authenticator app, or one of your recovery codes.`,
    ],
    footnote: "If you didn’t turn it on, change your password and review Sessions straight away.",
  });
}

export function mfaDisabledMessage(when: string): EmailContent {
  return compose("Two-factor authentication was turned off", {
    preheader: "Your Brawzer account no longer asks for a code when you sign in with a password.",
    heading: "Two-factor authentication was turned off",
    paragraphs: [
      `Two-factor authentication was turned off for your Brawzer account on ${when}. Signing in with your password no longer asks for a code.`,
    ],
    footnote:
      "If you didn’t turn it off, change your password, turn it back on and review Sessions.",
  });
}

export function recoveryCodeUsedMessage(when: string, remaining: number): EmailContent {
  const left = remaining === 1 ? "1 recovery code is" : `${String(remaining)} recovery codes are`;
  return compose("A recovery code was used to sign in to Brawzer", {
    preheader: `${left} left.`,
    heading: "A recovery code was used",
    paragraphs: [
      `Someone signed in to your Brawzer account with a recovery code on ${when}. ${left} left.`,
      "If you’ve lost your authenticator, create new recovery codes under Account after signing in.",
    ],
    footnote: "If it wasn’t you, change your password and review Sessions straight away.",
  });
}

export function confirmEmailChangeMessage(url: string): EmailContent {
  return compose("Confirm your new email address for Brawzer", {
    preheader: "Confirm this address to make it your Brawzer sign-in.",
    heading: "Confirm your new email address",
    paragraphs: [
      "Someone signed in to Brawzer asked to use this address for their account. If it was you, confirm it.",
      "The link works once and expires in 24 hours.",
    ],
    action: { label: "Confirm new email", url },
    footnote: "If you didn’t ask for this, ignore this email. Nothing will change.",
  });
}

export function emailChangeRequestedMessage(maskedNewEmail: string, when: string): EmailContent {
  return compose("Your Brawzer email address may change", {
    preheader: `A change to ${maskedNewEmail} was requested.`,
    heading: "Email change requested",
    paragraphs: [
      `On ${when}, someone signed in to your Brawzer account asked to change its email address to ${maskedNewEmail}. It changes only if that address is confirmed.`,
    ],
    footnote:
      "If this wasn’t you, sign in, change your password and review Sessions straight away.",
  });
}

export function emailChangedMessage(
  maskedNewEmail: string,
  when: string,
  undoUrl: string,
): EmailContent {
  return compose("Your Brawzer email address was changed", {
    preheader: `Your account now uses ${maskedNewEmail}. Undo it if this wasn’t you.`,
    heading: "Your email address was changed",
    paragraphs: [
      `On ${when}, your Brawzer account’s email address was changed to ${maskedNewEmail}. This address will no longer receive emails about the account.`,
      "If this wasn’t you, undo it: your account goes back to this address, you choose a new password, and every device is signed out.",
    ],
    action: { label: "Undo this change", url: undoUrl },
    footnote:
      "The undo link works once and expires in 7 days. If the change was yours, ignore this email.",
  });
}

export function emailChangeUndoneMessage(when: string, signInUrl: string): EmailContent {
  return compose("Your Brawzer email address was restored", {
    preheader: "This address is your Brawzer sign-in again.",
    heading: "Your email address was restored",
    paragraphs: [
      `On ${when}, an email change on your Brawzer account was undone. This address is your sign-in again, your new password is set, and every device was signed out.`,
      "Sign in with your new password. If you use passkeys or two-factor authentication, check them under Account: anyone who had your old password may have changed them.",
    ],
    action: { label: "Sign in", url: signInUrl },
    footnote: "Brawzer sends this whenever an email change is undone.",
  });
}

export function emailChangeRevertedMessage(when: string): EmailContent {
  return compose("This address was removed from a Brawzer account", {
    preheader: "The account went back to its previous email address.",
    heading: "This address was removed from a Brawzer account",
    paragraphs: [
      `On ${when}, the owner of the previous email address undid the change that made this address the account’s sign-in. The account went back to that address, and every device was signed out.`,
    ],
    footnote:
      "If you made the original change yourself, the previous address’s inbox was used to undo it. Sign in from that address to continue.",
  });
}

export function emailInUseMessage(signInUrl: string): EmailContent {
  return compose("Someone tried to use your email for another Brawzer account", {
    preheader: "This address already belongs to a Brawzer account.",
    heading: "This address already has an account",
    paragraphs: [
      "Someone signed in to a different Brawzer account asked to change its email address to this one. An address can belong to only one account, so nothing changed.",
      "If it was you, sign in to the account that already uses this address.",
    ],
    action: { label: "Sign in", url: signInUrl },
    footnote: "If it wasn’t you, you don’t need to do anything. Your account is unchanged.",
  });
}

export function accountDeletedMessage(when: string): EmailContent {
  return compose("Your Brawzer account was deleted", {
    preheader: "Your account and its data are gone.",
    heading: "Your account was deleted",
    paragraphs: [
      `Your Brawzer account and everything stored with it were deleted on ${when}. Every device was signed out.`,
      "This can’t be undone. You’re welcome to create a new account at any time.",
    ],
    footnote:
      "If you didn’t delete it, someone had access to your account: change the passwords you reuse elsewhere.",
  });
}

export function newDeviceSignInMessage(
  device: string,
  ip: string | null,
  when: string,
  url: string,
): EmailContent {
  return compose("New sign-in to your Brawzer account", {
    preheader: `${device} signed in to your account.`,
    heading: "New sign-in",
    paragraphs: [
      `Your Brawzer account was signed in to on ${when} from ${device}${ip ? ` (IP address ${ip})` : ""}, which it hasn’t been used from recently.`,
      "If this was you, there’s nothing to do. If not, sign that device out in Sessions and change your password.",
    ],
    action: { label: "Review sessions", url },
    footnote: "Brawzer sends this when a browser or network is new to your account.",
  });
}

export function phoneSignInMessage(
  device: string | null,
  ip: string | null,
  when: string,
  url: string,
): EmailContent {
  const where = device ?? "a computer";
  return compose("You approved a sign-in from your phone", {
    preheader: `${where} is now signed in to your account.`,
    heading: "Sign-in approved from your phone",
    paragraphs: [
      `On ${when} you approved, from your phone, a sign-in to your Brawzer account on ${where}${ip ? ` (IP address ${ip})` : ""}. That computer now has a shared-computer session, which ends when its browser closes or after a while without activity.`,
      "If you didn’t approve this, sign that device out in Sessions and change your password.",
    ],
    action: { label: "Review sessions", url },
    footnote: "Brawzer sends this every time a sign-in is approved from a phone.",
  });
}

/** Usage at or near a plan's limit (Phase 8, idea 20). `used` and `limit` arrive worded. */
export function usageNoticeMessage(
  kind: "browsing" | "storage" | "files",
  percent: number,
  used: string,
  limit: string,
  url: string,
): EmailContent {
  const reached = percent >= 100;
  const what =
    kind === "browsing"
      ? "this month’s cloud browser hours"
      : kind === "storage"
        ? "your Drive storage"
        : "the number of files your Drive holds";
  const subject = reached
    ? `You’ve reached ${kind === "browsing" ? "this month’s browsing hours" : kind === "storage" ? "your Drive storage limit" : "your Drive file limit"}`
    : `You’ve used ${String(percent)}% of ${what}`;
  const consequence =
    kind === "browsing"
      ? reached
        ? "New cloud browser sessions can’t start until the hours reset on the 1st (UTC). A session already running isn’t interrupted."
        : "When they run out, new cloud browser sessions can’t start until the 1st (UTC)."
      : reached
        ? "New uploads and downloads into Drive are refused until there is room. Nothing already stored is touched."
        : "When it’s full, new uploads and downloads into Drive are refused until there is room.";
  return compose(subject, {
    preheader: `${used} of ${limit}.`,
    heading: subject,
    paragraphs: [
      `You’ve used ${used} of ${limit}${kind === "browsing" ? " this month" : ""}.`,
      consequence,
      "Your plan, its limits and what you’ve used are on the Account page, where a plan with more room can be chosen when one is offered.",
    ],
    action: { label: "See your plan", url },
    footnote:
      kind === "browsing"
        ? "Brawzer sends this once at 80% and once at 100% of each month’s hours."
        : "Brawzer sends this once at 80% and once at 100%, and again only after you’ve made room.",
  });
}

export function teamInvitationMessage(team: string, invitedBy: string, url: string): EmailContent {
  return compose(`${invitedBy} invited you to the team “${team}” on Brawzer`, {
    preheader: `Join “${team}” from your Team page.`,
    heading: `Join “${team}” on Brawzer`,
    paragraphs: [
      `${invitedBy} invited you to their team “${team}”. In a team you use the owner’s plan, and share its proxies and its Drive space; your own profiles and files stay yours.`,
      "Sign in to Brawzer with this email address and open the Team page to join or decline. If you don’t have an account yet, create one with this address first. The invitation lasts 7 days.",
    ],
    action: { label: "Open the Team page", url },
    footnote:
      "If you don’t know who this is, ignore this email. Nothing happens unless you join from your own account.",
  });
}

// ── After sign-up ───────────────────────────────────────────────────────

export function welcomeMessage(appUrl: string, securityUrl: string): EmailContent {
  return compose("Welcome to Brawzer", {
    preheader: "Your computer in the cloud is ready.",
    heading: "Your computer in the cloud is ready",
    paragraphs: [
      "Thanks for confirming your email. Brawzer runs a whole computer for you in the cloud: browsers that open in an isolated container, Drive for your files, and a desktop of apps, all reached from any device without leaving anything behind on it.",
      "Three things to try first: open a cloud browser from the Dock, drop a file into Drive, and look at Shield, where every sign-in and change to your account is listed.",
      "Brawzer never sees your passwords, and a page in a cloud browser can't reach this computer. If anything about your account changes, an email like this one tells you.",
    ],
    action: { label: "Open Brawzer", url: appUrl },
    footnote: `How Brawzer keeps you safe: ${securityUrl}`,
  });
}

// ── Billing ─────────────────────────────────────────────────────────────

export function subscriptionStartedMessage(
  plan: string,
  price: string | null,
  renewsOn: string | null,
  trialEndsOn: string | null,
  url: string,
): EmailContent {
  const trial = trialEndsOn !== null;
  return compose(trial ? `Your ${plan} trial has started` : `You’re on the ${plan} plan`, {
    preheader: trial ? `Free until ${trialEndsOn}.` : `Thank you. ${plan} is active now.`,
    heading: trial ? `Your ${plan} trial has started` : `Welcome to ${plan}`,
    paragraphs: [
      trial
        ? `${plan} is yours to use in full until ${trialEndsOn}. If you keep it, the first payment is taken then; cancel before and nothing is charged.`
        : `Thank you. ${plan}’s limits apply from now, and your plan renews on its own until you cancel.`,
      "Your plan, its limits, invoices and the way to change or cancel it are on the Account page.",
    ],
    facts: [
      ["Plan", plan],
      ...(price ? ([["Price", price]] as const) : []),
      ...(trial
        ? ([["Trial ends", trialEndsOn]] as const)
        : renewsOn
          ? ([["Renews on", renewsOn]] as const)
          : []),
    ],
    action: { label: "See your plan", url },
    footnote: "Brawzer sends this when a plan starts; receipts come from the payment provider.",
  });
}

export function subscriptionChangedMessage(
  plan: string,
  renewsOn: string | null,
  url: string,
): EmailContent {
  return compose(`Your plan is now ${plan}`, {
    preheader: `${plan}’s limits apply from now.`,
    heading: `Your plan is now ${plan}`,
    paragraphs: [
      `${plan}’s limits apply from now. Anything above the new limits stays as it is, but nothing more can be added until there is room.`,
    ],
    facts: [["Plan", plan], ...(renewsOn ? ([["Renews on", renewsOn]] as const) : [])],
    action: { label: "See your plan", url },
    footnote: "If you didn’t change your plan, sign in and check Shield for what happened.",
  });
}

export function subscriptionEndingMessage(plan: string, endsOn: string, url: string): EmailContent {
  return compose(`Your ${plan} plan ends on ${endsOn}`, {
    preheader: "Nothing more is charged; the free plan follows.",
    heading: `${plan} ends on ${endsOn}`,
    paragraphs: [
      `Your subscription was cancelled. ${plan} stays yours until ${endsOn}; after that the free plan and its limits apply, and nothing more is charged.`,
      "Your files, profiles and settings stay. Anything above the free plan’s limits is kept but can’t be added to until there is room.",
      "Changed your mind? Resume the plan from the Account page before it ends.",
    ],
    action: { label: "See your plan", url },
    footnote: "If you didn’t cancel, sign in and check Shield for what happened.",
  });
}

export function subscriptionEndedMessage(plan: string, url: string): EmailContent {
  return compose(`Your ${plan} plan has ended`, {
    preheader: "You’re on the free plan now.",
    heading: `${plan} has ended`,
    paragraphs: [
      "You’re on the free plan now, and nothing more is charged. Your files, profiles and settings stay; anything above the free plan’s limits is kept but can’t be added to until there is room.",
      "You can choose a plan again at any time from the Account page.",
    ],
    action: { label: "See your plan", url },
    footnote: "If this is a surprise, sign in and check Shield for what happened.",
  });
}

export function paymentFailedMessage(
  plan: string,
  amount: string | null,
  retryOn: string | null,
  url: string,
): EmailContent {
  return compose("Your payment for Brawzer didn’t go through", {
    preheader: "Update your card to keep your plan.",
    heading: "Your payment didn’t go through",
    paragraphs: [
      `The payment for your ${plan} plan${amount ? ` (${amount})` : ""} was declined by your bank or card. Nothing has changed yet.`,
      retryOn
        ? `The payment provider tries again on ${retryOn}. Update your card before then from the Account page and the plan carries on; if the payments keep failing, the plan ends and the free plan follows.`
        : "Update your card from the Account page and the plan carries on; if the payments keep failing, the plan ends and the free plan follows.",
    ],
    action: { label: "Update your payment method", url },
    footnote: "Brawzer never sees your card details; they are held by the payment provider.",
  });
}

export function trialEndingMessage(
  plan: string,
  endsOn: string,
  price: string | null,
  url: string,
): EmailContent {
  return compose(`Your ${plan} trial ends on ${endsOn}`, {
    preheader: price ? `${price} from then, unless you cancel.` : "Decide before then.",
    heading: `Your ${plan} trial ends on ${endsOn}`,
    paragraphs: [
      price
        ? `From ${endsOn}, ${plan} costs ${price}, taken from the card on file. To keep it, do nothing. To stop, cancel from the Account page before then and nothing is charged.`
        : `From ${endsOn} the plan is charged to the card on file. To keep it, do nothing. To stop, cancel from the Account page before then and nothing is charged.`,
    ],
    action: { label: "See your plan", url },
    footnote: "Brawzer sends this once, three days before a trial ends.",
  });
}

// ── Drive ───────────────────────────────────────────────────────────────

export function fileQuarantinedMessage(
  name: string,
  threat: string | null,
  source: "upload" | "browser",
  when: string,
  url: string,
): EmailContent {
  return compose(`“${name}” was quarantined in your Drive`, {
    preheader: "The malware scan found a threat. The file is isolated.",
    heading: "A file was quarantined",
    paragraphs: [
      `${source === "browser" ? "A file a cloud browser saved to your Drive" : "A file uploaded to your Drive"} matched known malware${threat ? ` (${threat})` : ""} and was put in quarantine at ${when}.`,
      "It is kept, but it can’t be opened, previewed, sent to a page or downloaded to a computer. You can delete it from Files. Nothing else in your Drive was touched, and the file never ran anywhere.",
    ],
    action: { label: "See the file", url },
    footnote:
      "Brawzer scans every file on its way into Drive. If you didn’t expect this file, check Shield for what else happened in your account.",
  });
}

// ── Teams ───────────────────────────────────────────────────────────────

export function teamMemberJoinedMessage(
  team: string,
  who: string,
  url: string,
  unsubscribeUrl: string,
): EmailContent {
  return compose(`${who} joined “${team}”`, {
    preheader: "They use the team’s plan and shared Drive from now.",
    heading: `${who} joined “${team}”`,
    paragraphs: [
      `${who} accepted the invitation to your team. They use the team’s plan and can see the shared Drive from now; their own profiles and files stay theirs.`,
    ],
    action: { label: "Open the Team page", url },
    footnote: "Team members, roles and invitations are managed on the Team page.",
    unsubscribe: { reason: "You get team updates because you run this team.", url: unsubscribeUrl },
  });
}

export function teamMemberRemovedMessage(team: string, url: string): EmailContent {
  return compose(`You’re no longer in “${team}”`, {
    preheader: "Your own plan and limits apply again.",
    heading: `You’re no longer in “${team}”`,
    paragraphs: [
      `An owner or admin of “${team}” removed you. Your own plan and limits apply again, and you no longer see the team’s shared Drive. Your own profiles, files and settings are untouched.`,
    ],
    action: { label: "See your account", url },
    footnote: "If you think this is a mistake, ask the team’s owner for a new invitation.",
  });
}

export function teamOwnershipTransferredMessage(
  team: string,
  from: string,
  url: string,
): EmailContent {
  return compose(`You now own “${team}”`, {
    preheader: "The team uses your plan from now.",
    heading: `You now own “${team}”`,
    paragraphs: [
      `${from} made you the owner of “${team}”. The team uses your plan and its limits from now, and you can invite, remove and change the roles of its members. ${from} stays in the team as an admin.`,
    ],
    action: { label: "Open the Team page", url },
    footnote: "Ownership can be passed on again from the Team page.",
  });
}

// ── For the people who run Brawzer ──────────────────────────────────────

export function adminNoticeMessage(
  kind: "sign-up" | "subscription" | "report" | "quarantine",
  facts: readonly (readonly [string, string])[],
  url: string,
): EmailContent {
  const title =
    kind === "sign-up"
      ? "A new account was created"
      : kind === "subscription"
        ? "A subscription changed"
        : kind === "report"
          ? "A page was reported"
          : "A file was quarantined";
  return compose(`Brawzer: ${title.toLowerCase()}`, {
    preheader: facts.map(([label, value]) => `${label}: ${value}`).join(" · "),
    heading: title,
    paragraphs: [
      kind === "sign-up"
        ? "Someone confirmed their email and has an account now."
        : kind === "subscription"
          ? "The payment provider reported a change to an account’s plan."
          : kind === "report"
            ? "Someone reported a page from a cloud browser. The report, with its picture if one was attached, is on the Admin page."
            : "The malware scan caught a file on its way into a Drive. It is isolated; nothing ran.",
    ],
    facts,
    action: { label: "Open the Admin page", url },
    footnote:
      "You get these because your address is in ADMIN_EMAILS. Set ADMIN_NOTIFICATIONS=none to stop them.",
  });
}
