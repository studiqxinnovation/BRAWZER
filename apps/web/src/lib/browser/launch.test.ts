import type { BrowserEngine, Profile, WebApp } from "@brawzer/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/lib/api/client";

type Created = (body: {
  name: string;
  color: string;
  engine: BrowserEngine;
}) => Promise<ApiResult<Profile>>;
type Updated = (id: string, body: { keepData: boolean }) => Promise<ApiResult<Profile>>;
const createProfile = vi.fn<Created>();
const updateProfile = vi.fn<Updated>();
vi.mock("@/lib/api/profiles", () => ({
  createProfile: (body: Parameters<Created>[0]) => createProfile(body),
  updateProfile: (id: string, body: Parameters<Updated>[1]) => updateProfile(id, body),
}));

const { profileForWebApp } = await import("./launch");

const whatsapp: WebApp = {
  id: "whatsapp",
  name: "WhatsApp",
  url: "https://web.whatsapp.com/",
  description: "",
  category: "Mail and chat",
  colour: "#128c7e",
  engine: "chrome",
};

function profile(fields: Partial<Profile>): Profile {
  return {
    id: "p-1",
    name: "Bee",
    color: "indigo",
    engine: "bee",
    position: 0,
    proxyId: null,
    keepData: false,
    keepHistory: false,
    browserAccount: false,
    privateThroughProxy: false,
    ...fields,
  } as Profile;
}

describe("profileForWebApp", () => {
  beforeEach(() => {
    createProfile.mockReset();
    updateProfile.mockReset();
    createProfile.mockImplementation((body) =>
      Promise.resolve({
        ok: true,
        status: 201,
        data: profile({ id: "new", name: body.name, engine: body.engine }),
      }),
    );
    updateProfile.mockImplementation((id, body) =>
      Promise.resolve({ ok: true, status: 200, data: profile({ id, keepData: body.keepData }) }),
    );
  });

  it("reuses the app's profile on that browser", async () => {
    const mine = profile({ id: "w", name: "whatsapp", engine: "chrome" });
    const result = await profileForWebApp("chrome", whatsapp, [mine]);
    expect(result).toEqual({ ok: true, status: 200, data: mine });
    expect(createProfile).not.toHaveBeenCalled();
  });

  it("makes one that keeps its data, named after the app", async () => {
    const result = await profileForWebApp("chrome", whatsapp, [profile({ color: "indigo" })]);
    expect(createProfile).toHaveBeenCalledWith({
      name: "WhatsApp",
      color: "teal",
      engine: "chrome",
    });
    expect(updateProfile).toHaveBeenCalledWith("new", { keepData: true });
    expect(result.ok && result.data.keepData).toBe(true);
  });

  it("names it after the browser too when another browser's profile has the plain name", async () => {
    const onBee = profile({ id: "old", name: "WhatsApp", engine: "bee" });
    await profileForWebApp("chrome", whatsapp, [onBee]);
    expect(createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "WhatsApp (Chrome)", engine: "chrome" }),
    );
    createProfile.mockClear();
    const alsoTaken = profile({ id: "x", name: "WhatsApp (Chrome)", engine: "firefox" });
    await profileForWebApp("chrome", whatsapp, [onBee, alsoTaken]);
    expect(createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "WhatsApp (Chrome) 2" }),
    );
    const reused = await profileForWebApp("chrome", whatsapp, [
      onBee,
      profile({ id: "c", name: "WhatsApp (Chrome)", engine: "chrome" }),
    ]);
    expect(reused.ok && reused.data.id).toBe("c");
  });
});
