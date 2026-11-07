import { describe, expect, it } from "vitest";
import { createLogger, NestPinoLogger, serializeRequest, stripQuery } from "./logger.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = {
    write(chunk: string) {
      lines.push(JSON.parse(chunk) as Record<string, unknown>);
    },
  };
  const logger = createLogger({ logLevel: "trace", logFormat: "json" }, destination);
  return { logger, lines };
}

describe("createLogger", () => {
  it("redacts credentials wherever they appear", () => {
    const { logger, lines } = capture();
    logger.info(
      {
        password: "hunter2",
        user: { token: "tok_live_123", passwordHash: "$argon2id$..." },
        proxy: { proxyPassword: "p@ss" },
        headers: { cookie: "session=abc", authorization: "Bearer xyz" },
      },
      "sign-in attempt",
    );

    const output = JSON.stringify(lines);
    for (const secret of [
      "hunter2",
      "tok_live_123",
      "$argon2id$",
      "p@ss",
      "session=abc",
      "Bearer xyz",
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[Redacted]");
    expect(lines[0]).toMatchObject({ msg: "sign-in attempt", service: "brawzer-api" });
  });

  it("logs requests without headers, query strings or IP addresses", () => {
    const { logger, lines } = capture();
    logger.info({
      req: { id: "r1", method: "GET", url: "/api/v1/health?token=abc", ip: "203.0.113.9" },
    });
    expect(lines[0]?.req).toEqual({ id: "r1", method: "GET", path: "/api/v1/health" });
  });
});

describe("stripQuery", () => {
  it("removes the query string", () => {
    expect(stripQuery("/a/b?x=1&y=2")).toBe("/a/b");
    expect(stripQuery("/a/b")).toBe("/a/b");
  });
});

describe("serializeRequest", () => {
  it("tolerates unexpected shapes", () => {
    expect(serializeRequest({})).toEqual({ id: undefined, method: undefined, path: undefined });
  });
});

describe("NestPinoLogger", () => {
  it("maps Nest's context argument and levels onto pino", () => {
    const { logger, lines } = capture();
    const nest = new NestPinoLogger(logger);
    nest.log("Mapped routes", "RouterExplorer");
    nest.error("Boom", "Error: Boom\n    at x", "ExceptionsHandler");
    nest.verbose("Detail");

    expect(lines[0]).toMatchObject({ level: 30, msg: "Mapped routes", context: "RouterExplorer" });
    expect(lines[1]).toMatchObject({ level: 50, msg: "Boom", context: "ExceptionsHandler" });
    expect(lines[1]?.stack).toContain("at x");
    expect(lines[2]).toMatchObject({ level: 10, msg: "Detail" });
  });
});
