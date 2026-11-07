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

export function passwordChangedMessage(when: string, device: string | null): EmailContent {
  return compose("Your Brawzer password was changed", {
    preheader: "Your password was changed and every device was signed out.",
    heading: "Your password was changed",
    paragraphs: [
      `Your Brawzer password was changed on ${when}${device ? ` from ${device}` : ""}.`,
      "For your security, every device that was signed in has been signed out.",
    ],
    footnote: "If you didn’t do this, reset your password straight away from the sign-in page.",
  });
}
