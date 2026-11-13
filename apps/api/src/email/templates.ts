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

interface LayoutOptions {
  preheader: string;
  heading: string;
  paragraphs: readonly string[];
  action?: { label: string; url: string };
  footnote: string;
}

function renderHtml({ preheader, heading, paragraphs, action, footnote }: LayoutOptions): string {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const body = paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#5e5b56;">${escapeHtml(text)}</p>`,
    )
    .join("");
  const button = action
    ? `<p style="margin:24px 0 20px;"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#2b5be0;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;line-height:20px;padding:12px 20px;border-radius:8px;">${escapeHtml(action.label)}</a></p>
<p style="margin:0;font-size:13px;line-height:18px;color:#6f6b65;">Or copy this link into your browser:<br><span style="word-break:break-all;color:#2453cf;">${escapeHtml(action.url)}</span></p>`
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
<tr><td style="padding:0 4px 20px;font-size:18px;font-weight:600;letter-spacing:-0.02em;color:#1c1b19;">Brawzer</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e2dd;border-radius:16px;padding:32px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.01em;color:#1c1b19;">${escapeHtml(heading)}</h1>
${body}${button}
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:18px;color:#6f6b65;">${escapeHtml(footnote)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderText({ heading, paragraphs, action, footnote }: LayoutOptions): string {
  return [
    heading,
    "",
    ...paragraphs.flatMap((text) => [text, ""]),
    ...(action ? [`${action.label}: ${action.url}`, ""] : []),
    footnote,
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
