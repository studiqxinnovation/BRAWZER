import { driveFileSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UsageNoticesService } from "../src/billing/usage-notices.service.js";
import { createHarness, type Harness } from "./support/harness.js";

let h: Harness;

const SMALL = {
  code: "small",
  name: "Small",
  stripePriceId: "price_small_month",
  limits: {
    profiles: 2,
    proxies: 2,
    driveBytes: 1000,
    driveFiles: 100,
    driveFolders: 10,
    browsingMinutesPerMonth: 60,
    liveSessions: 1,
  },
};

beforeAll(async () => {
  h = await createHarness({
    ipPrefix: "100.77.0",
    env: { BILLING_PLANS: JSON.stringify([SMALL]) },
  });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

async function browse(userId: string, minutes: number) {
  await h.database.pool.query(
    `insert into browser_sessions (user_id, auth_session_id, engine, status, agent_secret, started_at, ended_at, end_reason)
     select $1, s.id, 'bee', 'ended', '', now() - make_interval(mins => $2), now(), 'user'
       from auth_sessions s where s.user_id = $1 limit 1`,
    [userId, minutes],
  );
}

describe("usage notices", () => {
  it("emails once at 80% and once at 100%, per month for hours and per crossing for Drive", async () => {
    const client = h.browser();
    const email = h.uniqueEmail("usage-notices");
    await h.signUp(client, email);
    const userId = (await client.get("/auth/session")).json<{ account: { id: string } }>().account
      .id;
    await h.database.pool.query("update users set plan_code = 'small' where id = $1", [userId]);
    const notices = h.app.get(UsageNoticesService);
    const sentTo = async (kind: string) =>
      (
        await h.database.pool.query<{ threshold: number }>(
          "select threshold from usage_notices where user_id = $1 and kind = $2 order by threshold",
          [userId, kind],
        )
      ).rows.map((row) => row.threshold);

    // Browsing: 50 of 60 minutes is 83%; said once, however often the job runs.
    await browse(userId, 50);
    expect(await notices.run()).not.toBeNull();
    await notices.run();
    expect(await sentTo("browsing")).toEqual([80]);
    const warning = await h.waitForEmail(
      email,
      "You’ve used 83% of this month’s cloud browser hours",
    );
    expect(warning).toContain("0.8 hours of 1 hour");
    // Past the cap: the 100% email, once.
    await browse(userId, 20);
    await notices.run();
    await notices.run();
    expect(await sentTo("browsing")).toEqual([80, 100]);
    await h.waitForEmail(email, "You’ve reached this month’s browsing hours");

    // Drive: 900 of 1000 bytes; freeing the space makes a later crossing news again.
    const upload = async () => {
      const response = await client.upload("/drive/files", {
        name: "notes.txt",
        content: Buffer.alloc(900, "a"),
        type: "text/plain",
      });
      expect(response.statusCode, response.body).toBe(201);
      return driveFileSchema.parse(response.json());
    };
    const file = await upload();
    await notices.run();
    expect(await sentTo("storage")).toEqual([80]);
    await h.waitForEmail(email, "You’ve used 90% of your Drive storage");
    expect((await client.delete(`/drive/files/${file.id}`)).statusCode).toBe(204);
    // Trash still counts; removing it for good frees the space.
    expect((await client.delete(`/drive/trash/${file.id}`)).statusCode).toBe(204);
    await notices.run();
    expect(await sentTo("storage")).toEqual([]);
    await upload();
    await notices.run();
    expect(await sentTo("storage")).toEqual([80]);
    await h.waitForEmail(email, "You’ve used 90% of your Drive storage", 2);
  }, 120_000);
});
