import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from "@playwright/test";

/** Mailpit catches every email the local API sends (`pnpm infra:up`). */
const MAILPIT = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8125";

export const uniqueEmail = (tag: string) => `e2e-${tag}-${randomUUID().slice(0, 8)}@example.com`;

interface Summary {
  ID: string;
  Subject: string;
}

/**
 * Waits for the newest email to `to` whose subject contains `subject`, and
 * returns the link in it, moved onto the origin the tests browse. Emails link
 * to WEB_ORIGIN (localhost:3100); the tests use 127.0.0.1:3100, the same
 * server under a different cookie host.
 */
export async function linkFromEmail(
  request: APIRequestContext,
  to: string,
  subject: string,
  baseURL: string,
): Promise<string> {
  let found: Summary | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(`${MAILPIT}/api/v1/search`, {
          params: { query: `to:"${to}"` },
        });
        const { messages } = (await response.json()) as { messages: Summary[] };
        found = messages.find((message) => message.Subject.includes(subject));
        return found !== undefined;
      },
      { message: `waiting for "${subject}" to ${to}`, timeout: 10_000 },
    )
    .toBe(true);

  const message = (await (
    await request.get(`${MAILPIT}/api/v1/message/${found?.ID ?? ""}`)
  ).json()) as {
    Text: string;
  };
  const link = /(https?:\/\/\S+#token=[A-Za-z0-9_-]{43})/.exec(message.Text)?.[1];
  if (!link) throw new Error(`No link in "${subject}"`);
  const url = new URL(link);
  return `${new URL(baseURL).origin}${url.pathname}${url.hash}`;
}

/** Waits for the newest email to `to` whose subject contains `subject`, and returns its text. */
export async function emailText(
  request: APIRequestContext,
  to: string,
  subject: string,
): Promise<string> {
  let found: Summary | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(`${MAILPIT}/api/v1/search`, {
          params: { query: `to:"${to}"` },
        });
        const { messages } = (await response.json()) as { messages: Summary[] };
        found = messages.find((message) => message.Subject.includes(subject));
        return found !== undefined;
      },
      { message: `waiting for "${subject}" to ${to}`, timeout: 10_000 },
    )
    .toBe(true);
  const message = (await (
    await request.get(`${MAILPIT}/api/v1/message/${found?.ID ?? ""}`)
  ).json()) as { Text: string };
  return message.Text;
}

/** Creates and confirms an account through the API, as a person would through the pages. */
export async function createConfirmedAccount(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<void> {
  const origin = new URL(baseURL).origin;
  const registered = await request.post("/api/v1/auth/register", {
    data: { email, password },
    headers: { origin },
  });
  expect(registered.status()).toBe(202);
  const link = await linkFromEmail(request, email, "Confirm your email", baseURL);
  const token = new URL(link).hash.replace("#token=", "");
  const verified = await request.post("/api/v1/auth/verify-email", {
    data: { token, password },
    headers: { origin },
  });
  expect(verified.status()).toBe(200);
  // Verification signs in; start the browser tests signed out.
  await request.post("/api/v1/auth/logout", { headers: { origin } });
}

/** Signs a browser context in through the API; its pages then share the session cookie. */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<void> {
  const response = await context.request.post(`${new URL(baseURL).origin}/api/v1/auth/login`, {
    data: { email, password },
    headers: { origin: new URL(baseURL).origin },
  });
  expect(response.status()).toBe(200);
}

/** Another device: a separate browser context with its own cookies, signed in. */
export async function otherDevice(
  browser: Browser,
  baseURL: string,
  email: string,
  password: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  await signIn(context, baseURL, email, password);
  return context;
}

/** Signs out from a signed-in page, once it is interactive, and waits for the sign-in page. */
export async function signOut(page: Page): Promise<void> {
  // The session keeper marks <html> after hydration; clicking earlier does nothing.
  await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in\?signed_out=1$/);
}

/** The page's own cookie is signed in as `email`: asked of the API, not read off the page. */
export async function expectSignedInAs(page: Page, email: string): Promise<void> {
  // The page's own origin: a passkey test signs in on localhost, not the base URL.
  const response = await page.request.get(new URL("/api/v1/auth/session", page.url()).toString());
  expect(response.status()).toBe(200);
  expect(((await response.json()) as { account: { email: string } }).account.email).toBe(email);
}

/** Home's heading: a greeting by the person's own clock. */
export const GREETING = /^(Good (morning|afternoon|evening)|Welcome back)/;
