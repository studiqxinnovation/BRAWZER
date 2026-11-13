import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/env.js";
import { EnginesService } from "./engines.service.js";
import type { RuntimeHostsService } from "./runtime-hosts.service.js";

const ALL = ["bee", "chrome", "firefox", "edge", "chromium"] as const;

/** Runtime hosts whose image is built for each of `architectures` (an Error: the host can't be asked). */
function offering(architectures: (string | null | Error)[], engines: readonly string[] = ALL) {
  let asked = 0;
  const hosts = {
    all: () =>
      architectures.map((architecture) => ({
        docker: {
          imageArchitecture: () => {
            asked += 1;
            return architecture instanceof Error
              ? Promise.reject(architecture)
              : Promise.resolve(architecture);
          },
        },
      })),
  } as unknown as RuntimeHostsService;
  const config = { browser: { engines, image: "brawzer-runtime:dev" } } as unknown as AppConfig;
  return { engines: new EnginesService(hosts, config), asked: () => asked };
}

describe("the browsers offered", () => {
  it("include Edge when every runtime host's image is x86-64", async () => {
    const { engines } = offering(["amd64", "amd64"]);
    expect(await engines.offered()).toEqual(ALL);
  });

  it("leave Edge out where Microsoft ships no build: an ARM host, or a missing image", async () => {
    expect(await offering(["amd64", "arm64"]).engines.offered()).toEqual([
      "bee",
      "chrome",
      "firefox",
      "chromium",
    ]);
    expect(await offering([null]).engines.offered()).not.toContain("edge");
  });

  it("don't ask the hosts when the operator doesn't offer Edge", async () => {
    const { engines, asked } = offering(["amd64"], ["bee", "firefox"]);
    expect(await engines.offered()).toEqual(["bee", "firefox"]);
    expect(asked()).toBe(0);
  });

  it("remember the answer for a while, and leave Edge out while no host can be asked", async () => {
    const remembered = offering(["amd64"]);
    await remembered.engines.offered();
    await remembered.engines.offered();
    expect(remembered.asked()).toBe(1);

    const unreachable = offering([new Error("connect ECONNREFUSED")]);
    expect(await unreachable.engines.offered()).not.toContain("edge");
    // Not remembered: the next request asks again.
    await unreachable.engines.offered();
    expect(unreachable.asked()).toBe(2);
  });
});
