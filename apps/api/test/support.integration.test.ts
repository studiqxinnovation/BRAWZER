import {
  savedReplyListSchema,
  staffTicketListSchema,
  staffTicketSchema,
  supportStatsSchema,
  ticketListSchema,
  ticketSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

const ADMIN_EMAIL = `admin-support-${Date.now().toString(36)}@brawzer.test`;
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.81.0", env: { ADMIN_EMAILS: ADMIN_EMAIL } });
});

afterAll(async () => {
  await h.close();
});

async function giveRole(email: string, role: string) {
  await h.database.pool.query("update users set role = $2 where email = $1", [email, role]);
}

describe("support requests", () => {
  it("goes from Help to the inbox and back, by email too, with every step audited", async () => {
    const customer = h.browser();
    const customerEmail = h.uniqueEmail("customer");
    await h.signUp(customer, customerEmail);

    const care = h.browser();
    const careEmail = h.uniqueEmail("care");
    await h.signUp(care, careEmail);
    await giveRole(careEmail, "care");
    await h.signIn(care, careEmail);

    // The customer writes. They get a receipt; the founders get a notice.
    const created = await customer.post("/support/tickets", {
      subject: "I deleted my essay by mistake",
      category: "drive",
      body: "It was in Documents.\n\nCan you bring it back?",
    });
    expect(created.statusCode, created.body).toBe(201);
    const ticket = ticketSchema.parse(created.json());
    expect(ticket.number).toBeGreaterThan(0);
    expect(ticket.status).toBe("open");
    expect(ticket.messages.map((message) => message.kind)).toEqual(["customer"]);
    expect(await h.waitForEmail(customerEmail, "We’ve got your request")).toContain(
      `number ${String(ticket.number)}`,
    );
    expect(await h.waitForEmail(ADMIN_EMAIL, "support request came in")).toContain(
      "I deleted my essay",
    );

    // Validation: a subject and a message are needed; the category is one of ours.
    for (const body of [
      { subject: "", category: "drive", body: "hello" },
      { subject: "Help", category: "weather", body: "hello" },
      { subject: "Help", category: "drive", body: "" },
    ]) {
      const refused = await customer.post("/support/tickets", body);
      expect(refused.statusCode, refused.body).toBe(400);
    }

    // Their list and the request itself; nobody else's.
    const mine = ticketListSchema.parse((await customer.get("/support/tickets")).json());
    expect(mine.tickets.map((entry) => entry.id)).toEqual([ticket.id]);
    const other = h.browser();
    await h.signUp(other, h.uniqueEmail("other"));
    expect((await other.get(`/support/tickets/${ticket.id}`)).statusCode).toBe(404);
    // And the console is closed to customers.
    expect((await other.get("/console/support/tickets")).statusCode).toBe(403);

    // Customer care sees it in the inbox, the address masked, due by its target.
    const inbox = staffTicketListSchema.parse((await care.get("/console/support/tickets")).json());
    const listed = inbox.tickets.find((entry) => entry.id === ticket.id);
    expect(listed).toBeDefined();
    expect(listed?.customer.email).toContain("***");
    expect(listed?.customer.email).not.toBe(customerEmail);
    expect(listed?.responseDueAt).not.toBeNull();
    expect(inbox.counts.open).toBeGreaterThan(0);

    const full = staffTicketSchema.parse(
      (await care.get(`/console/support/tickets/${ticket.id}`)).json(),
    );
    expect(full.account.id).toBe(ticket.id === full.id ? full.customer.id : "");
    expect(full.account.handle).toBe(customerEmail.split("@")[0]);

    // Priority and assignment, audited.
    const careId = (
      await h.database.pool.query<{ id: string }>("select id from users where email = $1", [
        careEmail,
      ])
    ).rows[0]?.id;
    const changed = await care.patch(`/console/support/tickets/${ticket.id}`, {
      priority: "urgent",
      assigneeId: careId,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const urgent = staffTicketSchema.parse(changed.json());
    expect(urgent.priority).toBe("urgent");
    expect(urgent.assignee?.email).toBe(careEmail);
    expect(Date.parse(urgent.responseDueAt ?? "")).toBeLessThan(
      Date.parse(listed?.responseDueAt ?? ""),
    );
    // Only staff can be assigned.
    const wrong = await care.patch(`/console/support/tickets/${ticket.id}`, {
      assigneeId: full.customer.id,
    });
    expect(wrong.statusCode).toBe(422);

    // An internal note stays inside; a reply goes out by email and sets the status.
    const noted = await care.post(`/console/support/tickets/${ticket.id}/messages`, {
      body: "Their Trash has the file; restoring.",
      kind: "note",
    });
    expect(noted.statusCode, noted.body).toBe(200);
    const replied = await care.post(`/console/support/tickets/${ticket.id}/messages`, {
      body: "Good news: it’s back in Documents.",
      kind: "reply",
      setStatus: "solved",
    });
    expect(replied.statusCode, replied.body).toBe(200);
    const solved = staffTicketSchema.parse(replied.json());
    expect(solved.status).toBe("solved");
    expect(solved.firstResponseAt).not.toBeNull();
    expect(solved.messages.map((message) => message.kind)).toEqual(["customer", "note", "staff"]);
    expect(await h.waitForEmail(customerEmail, `Re: #${String(ticket.number)}`)).toContain(
      "it’s back in Documents",
    );

    // The customer sees the reply, not the note, and the staff member as Brawzer support.
    const seen = ticketSchema.parse((await customer.get(`/support/tickets/${ticket.id}`)).json());
    expect(seen.status).toBe("solved");
    expect(seen.messages.map((message) => [message.kind, message.author])).toEqual([
      ["customer", customerEmail.split("@")[0]],
      ["staff", "Brawzer support"],
    ]);

    // A low rating reopens it for a follow-up; performance shows it.
    const rated = await customer.post(`/support/tickets/${ticket.id}/rating`, {
      rating: 2,
      comment: "Took a while",
    });
    expect(rated.statusCode, rated.body).toBe(200);
    const reopened = ticketSchema.parse(rated.json());
    expect(reopened.status).toBe("open");
    expect(reopened.rating).toBe(2);
    expect(reopened.messages.at(-1)?.body).toContain("Reopened for a follow-up");
    const stats = supportStatsSchema.parse((await care.get("/console/support/stats")).json());
    expect(stats.ratings.low).toBeGreaterThan(0);
    const low = stats.lowRatings.find((entry) => entry.id === ticket.id);
    expect(low?.followedUp).toBe(false);
    expect(low?.comment).toBe("Took a while");

    // Rating again isn't possible until it's solved; replying works and keeps it open.
    expect(
      (await customer.post(`/support/tickets/${ticket.id}/rating`, { rating: 5 })).statusCode,
    ).toBe(409);
    const followed = await customer.post(`/support/tickets/${ticket.id}/messages`, {
      body: "Thanks anyway!",
    });
    expect(followed.statusCode).toBe(200);
    expect(ticketSchema.parse(followed.json()).status).toBe("open");
    const solvedByThem = await customer.post(`/support/tickets/${ticket.id}/solve`, {});
    expect(ticketSchema.parse(solvedByThem.json()).status).toBe("solved");

    // Everything staff did is in the audit log.
    const audit = await h.database.pool.query<{ action: string }>(
      "select action from staff_actions where target = $1 order by created_at",
      [full.customer.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "Changed a support request",
      "Noted on a support request",
      "Replied to a support request",
    ]);
  });

  it("keeps the team's saved replies, for the roles that answer requests", async () => {
    const care = h.browser();
    const careEmail = h.uniqueEmail("care");
    await h.signUp(care, careEmail);
    await giveRole(careEmail, "care");
    await h.signIn(care, careEmail);

    const added = await care.post("/console/support/replies", {
      name: "File restored",
      body: "Good news: the file is back in its folder.",
    });
    expect(added.statusCode, added.body).toBe(200);
    const list = savedReplyListSchema.parse(added.json());
    const reply = list.replies.find((entry) => entry.name === "File restored");
    expect(reply?.updatedBy).toBe(careEmail);

    const edited = await care.put(`/console/support/replies/${reply?.id ?? ""}`, {
      name: "File restored",
      body: "Good news: the file is back. Deleted files wait in Trash for 30 days.",
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(
      savedReplyListSchema.parse(edited.json()).replies.find((entry) => entry.id === reply?.id)
        ?.body,
    ).toContain("30 days");

    // Billing staff don't answer requests, so they can't see or change these.
    const billing = h.browser();
    const billingEmail = h.uniqueEmail("billing");
    await h.signUp(billing, billingEmail);
    await giveRole(billingEmail, "billing");
    await h.signIn(billing, billingEmail);
    expect((await billing.get("/console/support/replies")).statusCode).toBe(403);
    expect((await billing.get("/console/support/tickets")).statusCode).toBe(403);

    const deleted = await care.delete(`/console/support/replies/${reply?.id ?? ""}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(
      savedReplyListSchema.parse(deleted.json()).replies.some((entry) => entry.id === reply?.id),
    ).toBe(false);
  });
});
