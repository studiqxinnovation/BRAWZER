import { describe, expect, it } from "vitest";
import { DownloadTickets } from "./tickets.js";

function fakeRedis(store = new Map<string, string>()) {
  return {
    store,
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK" as const);
    },
    getdel: (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return Promise.resolve(value);
    },
  };
}

describe("DownloadTickets", () => {
  it("issues a ticket that redeems once, for its file only", async () => {
    const redis = fakeRedis();
    const tickets = new DownloadTickets(redis);
    const { ticket, expiresAt } = await tickets.issue("user-1", "file-1");
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(55_000);
    // Redis holds a hash, never the ticket itself.
    expect([...redis.store.keys()].some((key) => key.includes(ticket))).toBe(false);

    expect(await tickets.redeem(ticket, "file-2")).toBeNull();
    // A wrong file burns the ticket too.
    expect(await tickets.redeem(ticket, "file-1")).toBeNull();

    const second = await tickets.issue("user-1", "file-1");
    expect(await tickets.redeem(second.ticket, "file-1")).toBe("user-1");
    expect(await tickets.redeem(second.ticket, "file-1")).toBeNull();
  });

  it("refuses to issue or redeem when Redis is unavailable", async () => {
    const down = {
      set: () => Promise.reject(new Error("down")),
      getdel: () => Promise.reject(new Error("down")),
    };
    const tickets = new DownloadTickets(down);
    await expect(tickets.issue("u", "f")).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(tickets.redeem("x".repeat(43), "f")).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });
});
