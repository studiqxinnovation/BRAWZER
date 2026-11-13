import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/env.js";
import { EmailDeliveryService } from "./delivery.js";
import {
  adminNoticeMessage,
  fileQuarantinedMessage,
  paymentFailedMessage,
  setMarkUrl,
  subscriptionStartedMessage,
  teamMemberJoinedMessage,
  welcomeMessage,
} from "./templates.js";

describe("notices", () => {
  it("welcomes with the app and says what Brawzer never sees", () => {
    const message = welcomeMessage("http://localhost:3100/app", "http://localhost:3100/security");
    expect(message.subject).toBe("Welcome to Brawzer");
    expect(message.text).toContain("http://localhost:3100/app");
    expect(message.text).toContain("never sees your passwords");
  });

  it("shows the mark once it is known, and the facts as a table", () => {
    setMarkUrl("http://localhost:3100/brand/mark.png");
    const message = subscriptionStartedMessage(
      "Plus",
      "€9.00 a month",
      "12 December 2026",
      null,
      "http://x/y",
    );
    expect(message.html).toContain('src="http://localhost:3100/brand/mark.png"');
    expect(message.html).toContain("Renews on");
    expect(message.text).toContain("Price: €9.00 a month");
    setMarkUrl(null);
    expect(
      subscriptionStartedMessage("Plus", null, null, "1 January 2027", "http://x").html,
    ).not.toContain("<img");
  });

  it("puts the one-click stop link in an optional notice, in both versions, escaped", () => {
    const url = 'http://localhost:3100/unsubscribe#token=abc"><script>';
    const message = teamMemberJoinedMessage("Studio", "ana@example.com", "http://x/team", url);
    expect(message.text).toContain(
      "Stop these emails: http://localhost:3100/unsubscribe#token=abc",
    );
    expect(message.html).toContain("Stop these emails");
    expect(message.html).not.toContain("<script>");
  });

  it("names the threat and the way in for a quarantined file", () => {
    const message = fileQuarantinedMessage(
      "invoice.pdf.exe",
      "Eicar-Test-Signature",
      "browser",
      "now",
      "http://x",
    );
    expect(message.subject).toContain("invoice.pdf.exe");
    expect(message.text).toContain("Eicar-Test-Signature");
    expect(message.text).toContain("cloud browser");
    expect(paymentFailedMessage("Plus", "€9.00", "20 December 2026", "http://x").text).toContain(
      "tries again on 20 December 2026",
    );
  });

  it("tells administrators how to stop their notices", () => {
    const message = adminNoticeMessage("sign-up", [["Email", "a@b.c"]], "http://x/admin");
    expect(message.subject).toBe("Brawzer: a new account was created");
    expect(message.text).toContain("ADMIN_NOTIFICATIONS=none");
  });
});

describe("delivery webhook signatures", () => {
  const secret = `whsec_${Buffer.from("a-test-secret-of-some-length").toString("base64")}`;
  const service = (resendWebhookSecret: string | undefined) =>
    new EmailDeliveryService(
      { db: null } as never,
      { email: { resendWebhookSecret } } as unknown as AppConfig,
    );
  const sign = (id: string, timestamp: string, body: string) =>
    `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64")}`;

  it("accepts a current, correctly signed webhook and refuses the rest", () => {
    const body = '{"type":"email.bounced"}';
    const now = String(Math.floor(Date.now() / 1000));
    expect(() =>
      service(secret).verify(body, {
        id: "msg_1",
        timestamp: now,
        signature: sign("msg_1", now, body),
      }),
    ).not.toThrow();
    // Several signatures may be offered during a secret rotation; one match is enough.
    expect(() =>
      service(secret).verify(body, {
        id: "msg_1",
        timestamp: now,
        signature: `v1,bm90aGluZw== ${sign("msg_1", now, body)}`,
      }),
    ).not.toThrow();
    expect(() =>
      service(secret).verify(body, {
        id: "msg_1",
        timestamp: now,
        signature: sign("msg_2", now, body),
      }),
    ).toThrow(/invalid/);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(() =>
      service(secret).verify(body, {
        id: "msg_1",
        timestamp: old,
        signature: sign("msg_1", old, body),
      }),
    ).toThrow(/too old/);
    expect(() =>
      service(secret).verify(body, { id: undefined, timestamp: now, signature: undefined }),
    ).toThrow(/missing/);
    expect(() =>
      service(undefined).verify(body, {
        id: "msg_1",
        timestamp: now,
        signature: sign("msg_1", now, body),
      }),
    ).toThrow(/Not found/);
  });
});
