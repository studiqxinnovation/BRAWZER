import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EGRESS_HEALTH_PORT } from "../egress/egress.service.js";
import { egressAnswers } from "./orchestrator.service.js";

type Host = Parameters<typeof egressAnswers>[0];

/** A runtime host whose engine reports the egress published on `port`. */
const hostWith = (port: number | null, running = true): Host =>
  ({
    agentHost: "127.0.0.1",
    docker: {
      inspect: () =>
        Promise.resolve({
          running,
          exitCode: 0,
          hostPorts: port === null ? {} : { [EGRESS_HEALTH_PORT]: port },
        }),
    },
  }) as unknown as Host;

describe("egressAnswers", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  const listen = async (status: number): Promise<number> => {
    server = createServer((_req, res) => {
      res.writeHead(status).end();
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  };

  it("is true while the egress sidecar's health check answers", async () => {
    expect(await egressAnswers(hostWith(await listen(200)), "egress")).toBe(true);
  });

  it("is false when the port no longer answers: the runtime took the shared network", async () => {
    const port = await listen(200);
    server?.close();
    server = undefined;
    expect(await egressAnswers(hostWith(port), "egress", 2)).toBe(false);
  });

  it("is false when the sidecar answers with an error, has no published port, or stopped", async () => {
    expect(await egressAnswers(hostWith(await listen(503)), "egress", 1)).toBe(false);
    expect(await egressAnswers(hostWith(null), "egress", 1)).toBe(false);
    expect(await egressAnswers(hostWith(1, false), "egress", 1)).toBe(false);
  });
});
