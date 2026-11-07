import { loginRequestSchema, messageResponseSchema } from "@brawzer/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, fieldErrorsFromDetails, fieldErrorsFromIssues } from "./client";

function respond(status: number, body?: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("sends JSON to the same-origin API and validates the answer", async () => {
    respond(202, { message: "Check your email." });
    const result = await apiRequest("/auth/register", {
      method: "POST",
      body: { email: "a@example.com" },
      schema: messageResponseSchema,
    });
    expect(result).toEqual({ ok: true, status: 202, data: { message: "Check your email." } });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/auth/register");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
  });

  it("passes the API's error through unchanged", async () => {
    const error = { code: "invalid_credentials", message: "Email or password is incorrect." };
    respond(401, { error });
    expect(await apiRequest("/auth/login", { method: "POST", body: {} })).toEqual({
      ok: false,
      status: 401,
      error,
    });
  });

  it("explains a network failure instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const result = await apiRequest("/auth/logout", { method: "POST" });
    expect(result).toMatchObject({ ok: false, status: 0, error: { code: "service_unavailable" } });
  });

  it("treats a gateway error page as the API being unreachable", async () => {
    respond(502);
    expect(await apiRequest("/auth/session")).toMatchObject({
      ok: false,
      error: { code: "service_unavailable" },
    });
  });

  it("rejects a success response that doesn't match the contract", async () => {
    respond(200, { unexpected: true });
    expect(await apiRequest("/auth/register", { schema: messageResponseSchema })).toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
  });

  it("accepts an empty 204", async () => {
    respond(204);
    expect(await apiRequest("/auth/logout", { method: "POST" })).toEqual({
      ok: true,
      status: 204,
      data: undefined,
    });
  });
});

describe("field errors", () => {
  it("maps API details to one message per field", () => {
    expect(
      fieldErrorsFromDetails([
        "email: Enter a valid email address, like name@example.com.",
        "password: Use at least 10 characters.",
        "password: Second message is ignored.",
        "No field prefix",
      ]),
    ).toEqual({
      email: "Enter a valid email address, like name@example.com.",
      password: "Use at least 10 characters.",
    });
  });

  it("uses the shared contract's wording for client-side checks", () => {
    const result = loginRequestSchema.safeParse({ email: "", password: "" });
    expect(result.success).toBe(false);
    expect(fieldErrorsFromIssues(result.error?.issues ?? [])).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
  });
});
