import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { makeAdministrator, setRole } from "./database";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "copper-meadow-signal";

test.describe("technical pages", () => {
  test.skip(({ isMobile }) => isMobile, "The console is a desk tool; one run covers it.");

  test("a founder reads the fleet, images, catalogue, network and health", async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const founderEmail = uniqueEmail("founder");
    await createConfirmedAccount(page.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(page.context(), base, founderEmail, PASSWORD);

    await page.goto("/admin/fleet");
    await expect(page.getByRole("heading", { level: 1, name: "Fleet & regions" })).toBeVisible();
    await expect(page.getByLabel("Sessions in use")).toBeVisible();
    await expect(page.getByRole("heading", { name: "This installation’s region" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.goto("/admin/sessions");
    await expect(page.getByRole("heading", { level: 1, name: "Live sessions" })).toBeVisible();
    await expect(page.getByText("Machine facts only.")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.goto("/admin/images");
    await expect(page.getByRole("heading", { level: 1, name: "Browser images" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Bee Browser" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.goto("/admin/extensions");
    await expect(
      page.getByRole("heading", { level: 1, name: "Extension catalogue" }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: /Dark Reader/ })).toBeVisible();
    await expect(page.getByLabel("Status of Dark Reader")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.goto("/admin/network");
    await expect(page.getByRole("heading", { level: 1, name: "Proxy & Shield" })).toBeVisible();
    await expect(page.getByLabel("Saved proxies")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.goto("/admin/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Queues & health" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dependency checks" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Database (PostgreSQL)" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
  });

  test("care sees live sessions but not the fleet; technical sees both", async ({
    page,
    browser,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const careEmail = uniqueEmail("care");
    await createConfirmedAccount(page.request, base, careEmail, PASSWORD);
    await setRole(careEmail, "care");
    await signIn(page.context(), base, careEmail, PASSWORD);
    await page.goto("/admin/sessions");
    await expect(page.getByRole("heading", { level: 1, name: "Live sessions" })).toBeVisible();
    await page.goto("/admin/fleet");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();

    const techEmail = uniqueEmail("technical");
    const tech = await browser.newContext({ baseURL });
    await createConfirmedAccount(tech.request, base, techEmail, PASSWORD);
    await setRole(techEmail, "technical");
    await signIn(tech, base, techEmail, PASSWORD);
    const desk = await tech.newPage();
    await desk.goto("/admin");
    await expect(desk).toHaveURL(/\/admin\/announce$/);
    await desk.goto("/admin/fleet");
    await expect(desk.getByLabel("Sessions in use")).toBeVisible();
    await tech.close();
  });
});
