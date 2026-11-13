import { type AddressInfo, createServer, type Server } from "node:net";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { ClamdScanner, parseVerdict, ScannerUnavailableError } from "./clamd.js";

/**
 * A clamd stand-in speaking just enough of the protocol: PING, and INSTREAM
 * whose verdict depends on whether the content contains "EICAR".
 */
function fakeClamd(
  behaviour: "normal" | "size-limit" | "silent" = "normal",
): Promise<{ port: number; server: Server; received: Buffer[] }> {
  const received: Buffer[] = [];
  const server = createServer((socket) => {
    let data = Buffer.alloc(0);
    let command: string | null = null;
    socket.on("data", (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      if (command === null) {
        const end = data.indexOf(0);
        if (end === -1) return;
        command = data.subarray(0, end).toString();
        data = data.subarray(end + 1);
        if (command === "zPING") {
          socket.end("PONG\0");
          return;
        }
      }
      if (command !== "zINSTREAM") return;
      // Length-prefixed pieces until a zero length.
      while (data.length >= 4) {
        const size = data.readUInt32BE(0);
        if (size === 0) {
          if (behaviour === "silent") return;
          const content = Buffer.concat(received);
          if (behaviour === "size-limit") socket.end("INSTREAM size limit exceeded. ERROR\0");
          else if (content.includes("EICAR")) socket.end("stream: Eicar-Test-Signature FOUND\0");
          else socket.end("stream: OK\0");
          return;
        }
        if (data.length < 4 + size) return;
        received.push(Buffer.from(data.subarray(4, 4 + size)));
        data = data.subarray(4 + size);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: (server.address() as AddressInfo).port, server, received });
    });
  });
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function scanner(behaviour?: "normal" | "size-limit" | "silent", timeoutMs = 5_000) {
  const fake = await fakeClamd(behaviour);
  servers.push(fake.server);
  return { scanner: new ClamdScanner({ host: "127.0.0.1", port: fake.port, timeoutMs }), fake };
}

describe("ClamdScanner", () => {
  it("pings", async () => {
    const { scanner: clamd } = await scanner();
    await expect(clamd.ping()).resolves.toBeUndefined();
  });

  it("streams the content in pieces and reports a clean file", async () => {
    const { scanner: clamd, fake } = await scanner();
    const content = Buffer.alloc(300_000, 65);
    const verdict = await clamd.scan(
      Readable.from([content.subarray(0, 100_000), content.subarray(100_000)]),
    );
    expect(verdict).toEqual({ verdict: "clean" });
    expect(Buffer.concat(fake.received).equals(content)).toBe(true);
  });

  it("reports an infected file with its signature", async () => {
    const { scanner: clamd } = await scanner();
    await expect(clamd.scan(Readable.from([Buffer.from("hello EICAR world")]))).resolves.toEqual({
      verdict: "infected",
      signature: "Eicar-Test-Signature",
    });
  });

  it("treats unexpected replies, silence and a missing scanner as unavailable", async () => {
    const limited = await scanner("size-limit");
    await expect(limited.scanner.scan(Readable.from([Buffer.from("x")]))).rejects.toBeInstanceOf(
      ScannerUnavailableError,
    );
    const silent = await scanner("silent", 200);
    await expect(silent.scanner.scan(Readable.from([Buffer.from("x")]))).rejects.toThrow(
      /didn't answer/,
    );
    const missing = new ClamdScanner({ host: "127.0.0.1", port: 1, timeoutMs: 1000 });
    await expect(missing.ping()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it("parses clamd's replies", () => {
    expect(parseVerdict("stream: OK\n")).toEqual({ verdict: "clean" });
    expect(parseVerdict("stream: Win.Test.EICAR_HDB-1 FOUND")).toEqual({
      verdict: "infected",
      signature: "Win.Test.EICAR_HDB-1",
    });
    expect(() => parseVerdict("stream: something odd")).toThrow(ScannerUnavailableError);
  });
});
