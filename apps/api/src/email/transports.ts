import type { EmailConfig } from "../config/env.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, such as List-Unsubscribe on an optional notice. */
  headers?: Readonly<Record<string, string>>;
  /** What kind of email, for the provider's own reporting ("category": "welcome"). */
  tags?: Readonly<Record<string, string>>;
  /** The same key twice sends once (a webhook delivered again mustn't email again). */
  idempotencyKey?: string;
}

export interface EmailTransport {
  send(email: OutgoingEmail): Promise<void>;
}

/** Splits `Brawzer <no-reply@example.com>` into its name and address. */
export function parseSender(from: string): { name: string | undefined; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (match?.[2]) return { name: match[1] === "" ? undefined : match[1], email: match[2] };
  return { name: undefined, email: from.trim() };
}

/** "ana@example.com" → "a***@example.com", for logs. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Local development: delivers to the Mailpit inbox at http://localhost:8125. */
export class MailpitTransport implements EmailTransport {
  constructor(
    private readonly apiUrl: string,
    private readonly from: string,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const sender = parseSender(this.from);
    const response = await fetch(new URL("/api/v1/send", this.apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: sender.email, Name: sender.name },
        To: [{ Email: email.to }],
        Subject: email.subject,
        Text: email.text,
        HTML: email.html,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Mailpit responded ${String(response.status)}`);
  }
}

/** Production: Resend's HTTP API. Needs RESEND_API_KEY and a verified sending domain. */
export class ResendTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.headers ? { headers: email.headers } : {}),
        ...(email.tags
          ? { tags: Object.entries(email.tags).map(([name, value]) => ({ name, value })) }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Resend responded ${String(response.status)}`);
  }
}

/** Writes nothing anywhere except a log line; message bodies contain secrets and are never logged. */
export class LogTransport implements EmailTransport {
  constructor(private readonly log: (message: string) => void) {}

  send(email: OutgoingEmail): Promise<void> {
    this.log(`Email to ${maskEmail(email.to)}: "${email.subject}" (log transport: not delivered)`);
    return Promise.resolve();
  }
}

export function createTransport(
  config: EmailConfig,
  log: (message: string) => void,
): EmailTransport {
  switch (config.transport) {
    case "mailpit":
      return new MailpitTransport(config.mailpitApiUrl, config.from);
    case "resend":
      if (!config.resendApiKey)
        throw new Error("RESEND_API_KEY is required for the resend transport");
      return new ResendTransport(config.resendApiKey, config.from, config.replyTo);
    case "log":
      return new LogTransport(log);
  }
}
