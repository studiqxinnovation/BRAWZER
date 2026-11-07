import { browserEngines, profileColors, securityEventTypes } from "@brawzer/contracts";
import { schema } from "@brawzer/db";
import { describe, expect, it } from "vitest";

describe("enums shared by the database and the contracts", () => {
  it("list the same security event types", () => {
    expect([...schema.securityEventType.enumValues]).toEqual([...securityEventTypes]);
  });

  it("list the same profile colours and browser engines", () => {
    expect([...schema.profileColor.enumValues]).toEqual([...profileColors]);
    expect([...schema.browserEngine.enumValues]).toEqual([...browserEngines]);
  });
});
