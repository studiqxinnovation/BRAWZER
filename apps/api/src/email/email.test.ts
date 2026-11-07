import { describe, expect, it, vi } from "vitest";
import {
  accountExistsMessage,
  escapeHtml,
  passwordChangedMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from "./templates.js";
import { createTransport, LogTransport, maskEmail, parseSender } from "./transports.js";

const link = "http://localhost:3100/verify-email#token=pHsTsTYKhDlUboNIOM4P3FqznaDVgB3ZLB78c9PHJX8";

describe("templates", () => {
  it("escapes every interpolated value", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("puts the link in both the HTML and the text version", () => {
    const message = verifyEmailMessage(link);
    expect(message.text).toContain(link);
    expect(message.html).toContain(`href="${link}"`);
    expect(message.text).toContain("password you chose");
  });

  it("cannot be broken out of by a hostile link", () => {
    const message = resetPasswordMessage(`https://x.example/"><script>alert(1)</script>`);
    expect(message.html).not.toContain("<script>");
  });

  it("states the real link lifetimes", () => {
    expect(verifyEmailMessage(link).text).toContain("24 hours");
    expect(resetPasswordMessage(link).text).toContain("30 minutes");
  });

  it("tells the owner when someone tries to sign up with their address", () => {
    const message = accountExistsMessage("http://localhost:3100/sign-in");
    expect(message.subject).toMatch(/tried to create/);
    expect(message.text).toContain("http://localhost:3100/sign-in");
  });

  it("names the device in the password-changed notice when known", () => {
    expect(
      passwordChangedMessage("6 November 2026 at 16:00 UTC", "Chrome on Windows").text,
    ).toContain("from Chrome on Windows");
    expect(passwordChangedMessage("6 November 2026 at 16:00 UTC", null).text).not.toMatch(
      /UTC from /,
    );
  });
});

describe("transports", () => {
  it("parses a display-name sender", () => {
    expect(parseSender("Brawzer <no-reply@brawzer.localhost>")).toEqual({
      name: "Brawzer",
      email: "no-reply@brawzer.localhost",
    });
    expect(parseSender("no-reply@brawzer.localhost")).toEqual({
      name: undefined,
      email: "no-reply@brawzer.localhost",
    });
  });

  it("masks addresses for logs", () => {
    expect(maskEmail("ana.lopez@example.com")).toBe("a***@example.com");
  });

  it("never logs the message body, which contains the link", async () => {
    const log = vi.fn<(message: string) => void>();
    await new LogTransport(log).send({ to: "ana@example.com", ...verifyEmailMessage(link) });
    expect(log).toHaveBeenCalledOnce();
    const line = log.mock.calls[0]?.[0] ?? "";
    expect(line).not.toContain("token");
    expect(line).not.toContain("ana@");
  });

  it("refuses the Resend transport without an API key", () => {
    expect(() =>
      createTransport(
        {
          transport: "resend",
          from: "x@y.z",
          mailpitApiUrl: "http://127.0.0.1:8125",
          resendApiKey: undefined,
        },
        () => undefined,
      ),
    ).toThrow(/RESEND_API_KEY/);
  });
});
