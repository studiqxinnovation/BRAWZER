import { adminRuntimeSchema, browserSessionSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

const ADMIN_EMAIL = `admin-runtime-${Date.now().toString(36)}@brawzer.test`;
let h: Harness;

beforeAll(async () => {
  h = await createHarness({
    ipPrefix: "100.78.0",
    env: { BROWSER_TEST_SITE: "true", ADMIN_EMAILS: ADMIN_EMAIL },
  });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

describe("the Admin page's cloud browser view", () => {
  it("shows hosts and live sessions to administrators only, and ends a session on their word", async () => {
    const user = h.browser();
    const email = h.uniqueEmail("admin-runtime-user");
    await h.signUp(user, email);
    const started = await user.post("/browser/sessions", {});
    expect(started.statusCode, started.body).toBe(201);
    const session = browserSessionSchema.parse(started.json());

    // Not for everyone.
    expect((await user.get("/admin/runtime")).statusCode).toBe(403);
    expect((await user.delete(`/admin/sessions/${session.id}`)).statusCode).toBe(403);

    const admin = h.browser();
    await h.signUp(admin, ADMIN_EMAIL);
    const view = await admin.get("/admin/runtime");
    expect(view.statusCode, view.body).toBe(200);
    const runtime = adminRuntimeSchema.parse(view.json());
    expect(runtime.hosts.map((host) => host.name)).toEqual(["local"]);
    expect(runtime.hosts[0]?.healthy).toBe(true);
    const listed = runtime.sessions.find((candidate) => candidate.id === session.id);
    expect(listed).toMatchObject({ email, engine: "bee", host: "local", throughProxy: false });

    // Ended by the administrator: gone from the view, and the owner is told why.
    expect((await admin.delete(`/admin/sessions/${session.id}`)).statusCode).toBe(204);
    const after = adminRuntimeSchema.parse((await admin.get("/admin/runtime")).json());
    expect(after.sessions.some((candidate) => candidate.id === session.id)).toBe(false);
    const own = await user.get("/browser");
    expect(own.json<{ session: unknown }>().session).toBeNull();
    const history = await user.get("/security/events");
    const ended = history
      .json<{ events: { type: string; details: { reason?: string } }[] }>()
      .events.find((event) => event.type === "browser.session_ended");
    expect(ended?.details.reason).toBe("admin");
    expect((await admin.delete(`/admin/sessions/${session.id}`)).statusCode).toBe(204);
  }, 120_000);
});
