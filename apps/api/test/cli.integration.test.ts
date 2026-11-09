import { browserSessionSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../src/cli/commands.js";
import { createHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({
    ipPrefix: "100.79.0",
    env: {
      BROWSER_TEST_SITE: "true",
      BILLING_PLANS: JSON.stringify([
        {
          code: "team",
          name: "Team",
          stripePriceId: "price_team_month",
          limits: {
            profiles: 20,
            proxies: 20,
            driveBytes: 10_000_000,
            driveFiles: 1000,
            driveFolders: 100,
            browsingMinutesPerMonth: null,
            liveSessions: 2,
          },
        },
      ]),
    },
  });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

async function run(...argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await runCommand(h.app, argv, (line) => lines.push(line));
  return { code, out: lines.join("\n") };
}

describe("the operator CLI", () => {
  it("finds accounts, grants plans with a reason, lists and ends sessions, runs the jobs", async () => {
    expect((await run()).code).toBe(2);
    expect((await run("help")).out).toContain("grant-plan <email> <plan> <why>");
    expect((await run("nonsense")).code).toBe(2);

    const client = h.browser();
    const email = h.uniqueEmail("cli");
    await h.signUp(client, email);
    expect((await run("find-account", email)).out).toContain(`${email}\tfree\tfree`);

    // A plan by hand, with the reason in the owner's history.
    expect((await run("grant-plan", email, "team")).code).toBe(2);
    const granted = await run("grant-plan", email, "team", "Pilot", "customer");
    expect(granted.code, granted.out).toBe(0);
    expect((await run("find-account", email)).out).toContain(`${email}\tteam\tadmin`);
    expect(await h.eventTypes(email)).toEqual(expect.arrayContaining(["admin.plan_changed"]));
    expect((await run("grant-plan", "nobody@brawzer.test", "team", "x")).code).toBe(1);

    // Sessions: listed with their host, and ended.
    const started = await client.post("/browser/sessions", {});
    expect(started.statusCode, started.body).toBe(201);
    const session = browserSessionSchema.parse(started.json());
    const listed = await run("sessions");
    expect(listed.out).toContain("host local\treachable");
    expect(listed.out).toContain(`${session.id}\t${email}\tbee\tlocal`);
    expect((await run("end-session", "not-an-id")).code).toBe(2);
    expect((await run("end-session", session.id)).code).toBe(0);
    expect((await run("sessions")).out).not.toContain(session.id);

    // The jobs answer with what they did.
    expect((await run("usage-notices")).out).toMatch(/\d+ sent, \d+ cleared\./);
    expect((await run("retention")).out).toContain("securityEvents:");
    expect((await run("rewrap")).out.length).toBeGreaterThan(0);
  }, 120_000);
});
