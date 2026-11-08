import {
  accountExportSchema,
  MAX_SITE_RULES,
  siteRuleListSchema,
  siteRuleSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.71.0" });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

describe("site rules", () => {
  it("keeps blocked and allowed hosts per account, normalised, within the limit", async () => {
    const client = h.browser();
    await h.signUp(client, h.uniqueEmail("site-rules"));
    expect(siteRuleListSchema.parse((await client.get("/site-rules")).json())).toEqual({
      rules: [],
      limit: MAX_SITE_RULES,
    });

    // Hosts are stored as a resolver reads them; a leading www. or *. is dropped.
    const blocked = await client.post("/site-rules", {
      kind: "block",
      host: "WWW.Tracker.Example",
    });
    expect(blocked.statusCode, blocked.body).toBe(201);
    expect(siteRuleSchema.parse(blocked.json())).toMatchObject({
      kind: "block",
      host: "tracker.example",
    });
    const allowed = await client.post("/site-rules", { kind: "allow", host: "*.wörk.example" });
    expect(allowed.statusCode, allowed.body).toBe(201);
    expect(siteRuleSchema.parse(allowed.json()).host).toBe("xn--wrk-sna.example");
    const address = await client.post("/site-rules", { kind: "block", host: "[2001:db8::1]" });
    expect(address.statusCode, address.body).toBe(201);
    expect(siteRuleSchema.parse(address.json()).host).toBe("2001:db8::1");

    // The same host can't be listed twice on one list; it can be on both (block wins).
    const again = await client.post("/site-rules", { kind: "block", host: "tracker.example" });
    expect(again.statusCode).toBe(409);
    expect(
      (await client.post("/site-rules", { kind: "allow", host: "tracker.example" })).statusCode,
    ).toBe(201);

    for (const [body, detail] of [
      [{ kind: "block", host: "not a host" }, "host: Enter only the host name"],
      [{ kind: "block", host: "https://example.com/path" }, "host: Enter only the host name"],
      [{ kind: "block", host: "localhost" }, "host: Enter the full host name"],
      [{ kind: "block", host: "0x7f.1" }, "host: Enter a website’s host name"],
      [{ kind: "sometimes", host: "example.com" }, "kind: Choose allow or block."],
    ] as const) {
      const response = await client.post("/site-rules", body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(h.errorOf(response).details?.join("\n")).toContain(detail);
    }

    const list = siteRuleListSchema.parse((await client.get("/site-rules")).json());
    expect(list.rules.map((rule) => `${rule.kind} ${rule.host}`)).toEqual([
      "allow tracker.example",
      "allow xn--wrk-sna.example",
      "block 2001:db8::1",
      "block tracker.example",
    ]);

    // The data export lists them; another account sees none of it.
    const exported = accountExportSchema.parse((await client.get("/account/export")).json());
    expect(exported.siteRules.map((rule) => rule.host)).toContain("tracker.example");
    const other = h.browser();
    await h.signUp(other, h.uniqueEmail("site-rules-other"));
    expect(siteRuleListSchema.parse((await other.get("/site-rules")).json()).rules).toEqual([]);
    const ruleId = siteRuleSchema.parse(blocked.json()).id;
    expect((await other.delete(`/site-rules/${ruleId}`)).statusCode).toBe(404);
    expect((await client.delete(`/site-rules/${ruleId}`)).statusCode).toBe(204);
    expect((await client.delete(`/site-rules/${ruleId}`)).statusCode).toBe(404);
  });

  it("stops at the account's limit", async () => {
    const client = h.browser();
    await h.signUp(client, h.uniqueEmail("site-rules-limit"));
    for (let i = 0; i < MAX_SITE_RULES; i++) {
      const response = await client.post("/site-rules", {
        kind: "block",
        host: `site-${String(i)}.example`,
      });
      expect(response.statusCode, response.body).toBe(201);
    }
    const over = await client.post("/site-rules", { kind: "block", host: "one-more.example" });
    expect(over.statusCode).toBe(409);
    expect(h.errorOf(over).code).toBe("limit_reached");
  }, 60_000);
});
