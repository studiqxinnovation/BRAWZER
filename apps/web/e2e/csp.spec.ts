import { expect, type Page, test } from "@playwright/test";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

// Account pages and the signed-in app run under a strict, per-request script
// policy: only scripts carrying the response's nonce (or the theme script's
// hash) may run.

function scriptSrc(policy: string | undefined): string {
  return (
    (policy ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src ")) ?? ""
  );
}

/** Records every CSP violation the page reports, from the very first script. */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __violations: string[] }).__violations = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      // Zod probes `Function("")` once (inside try/catch) to detect strict
      // CSP and take its no-eval path. The browser still reports it, with
      // an empty sample. Real evaluated code always carries a sample.
      if (event.blockedURI === "eval" && event.sample === "") return;
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
}

/**
 * Simulates HTML injection (the realistic XSS): markup carrying an inline
 * event handler. True if the handler ran. (A <script> created from
 * JavaScript isn't a fair test: 'strict-dynamic' trusts code that already
 * runs, and an attacker who can run code has already won.)
 */
let probes = 0;

async function injectedMarkupRuns(page: Page): Promise<boolean> {
  probes += 1;
  // A new URL each time, so a cached 404 can't skip the request.
  const src = `/csp-probe-missing-${String(probes)}.png`;
  const requested = page.waitForResponse((response) => response.url().endsWith(src));
  await page.evaluate((url) => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<img alt="" src="${url}" onerror="window.__injected = true">`,
    );
  }, src);
  await requested;
  // Give the failed image load time to fire its (blocked or not) handler.
  await page.waitForTimeout(200);
  return page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected === true);
}

test.describe("strict script policy", () => {
  test("account pages get a fresh nonce on every response, and no inline allowance", async ({
    request,
  }) => {
    const first = (await request.get("/sign-in")).headers()["content-security-policy"];
    const second = (await request.get("/sign-in")).headers()["content-security-policy"];
    for (const policy of [first, second]) {
      expect(scriptSrc(policy)).toMatch(/'nonce-[A-Za-z0-9+/=]{24}'/);
      expect(scriptSrc(policy)).toContain("'strict-dynamic'");
      expect(scriptSrc(policy)).not.toContain("'unsafe-inline'");
    }
    expect(first).not.toBe(second);
  });

  test("only a browser window may be framed, and only by Brawzer's own desktop", async ({
    page,
    baseURL,
  }) => {
    const email = uniqueEmail("csp-frame");
    await createConfirmedAccount(page.request, baseURL ?? "", email, "violet-harbor-lantern");
    await signIn(page.context(), baseURL ?? "", email, "violet-harbor-lantern");
    const framing = async (path: string) => {
      const headers = (await page.request.get(path, { maxRedirects: 0 })).headers();
      const ancestors = (headers["content-security-policy"] ?? "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("frame-ancestors "));
      return [ancestors, headers["x-frame-options"]];
    };
    for (const path of ["/", "/sign-in", "/app", "/app/browser", "/app/account"]) {
      expect(await framing(path), path).toEqual(["frame-ancestors 'none'", "DENY"]);
    }
    expect(await framing("/app/browser/window?session=x&embedded=1")).toEqual([
      "frame-ancestors 'self'",
      "SAMEORIGIN",
    ]);
  });

  test("account pages load without violations and block injected markup", async ({ page }) => {
    const violations = await watchViolations(page);
    for (const path of [
      "/sign-in",
      "/create-account",
      "/forgot-password",
      "/confirm-email-change",
      "/undo-email-change",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await violations(), path).toEqual([]);
      expect(await injectedMarkupRuns(page), path).toBe(false);
    }
  });

  test("the signed-in app loads without violations and blocks injected markup", async ({
    page,
    baseURL,
  }) => {
    const email = uniqueEmail("csp");
    await createConfirmedAccount(page.request, baseURL ?? "", email, "violet-harbor-lantern");
    await signIn(page.context(), baseURL ?? "", email, "violet-harbor-lantern");
    const violations = await watchViolations(page);

    for (const path of ["/app", "/app/sessions", "/app/shield", "/app/account"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await violations(), path).toEqual([]);
      expect(await injectedMarkupRuns(page), path).toBe(false);
    }
  });

  test("links from the public site open account pages as fresh page loads", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Get started" }).first().click();
    await expect(page).toHaveURL(/\/create-account$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Client-side navigation would have kept the home page's policy.
    expect(await injectedMarkupRuns(page)).toBe(false);
  });
});
