import { securityEventTypes } from "@brawzer/contracts";
import { schema } from "@brawzer/db";
import { describe, expect, it } from "vitest";

describe("security event types", () => {
  it("are identical in the database enum and the shared contract", () => {
    expect([...schema.securityEventType.enumValues]).toEqual([...securityEventTypes]);
  });
});
