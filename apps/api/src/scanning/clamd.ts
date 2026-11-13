import { connect, type Socket } from "node:net";
import type { Readable } from "node:stream";

export type ScanVerdict = { verdict: "clean" } | { verdict: "infected"; signature: string };

export interface Scanner {
  /** Reads the whole stream. Throws ScannerUnavailableError when clamd can't be used. */
  scan(content: Readable): Promise<ScanVerdict>;
  ping(): Promise<void>;
}

/** The scanner couldn't be reached or answered unexpectedly: uploads are refused, not stored unscanned. */
export class ScannerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScannerUnavailableError";
  }
}

export interface ClamdOptions {
  host: string;
  port: number;
  /** For connecting and for the whole scan. */
  timeoutMs?: number;
}

/**
 * ClamAV's clamd over TCP, with the INSTREAM command: the file is sent in
 * length-prefixed pieces and clamd answers `stream: OK` or
 * `stream: <signature> FOUND`. Null-terminated commands and replies.
 */
export class ClamdScanner implements Scanner {
  private readonly timeoutMs: number;

  constructor(private readonly options: ClamdOptions) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private open(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.options.host, port: this.options.port, noDelay: true });
      socket.setTimeout(this.timeoutMs);
      socket.once("connect", () => {
        resolve(socket);
      });
      socket.once("error", (error) => {
        reject(new ScannerUnavailableError(`Can't reach the scanner: ${error.message}`));
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new ScannerUnavailableError("The scanner didn't answer in time"));
      });
    });
  }

  /** Everything clamd says until its null terminator. */
  private reply(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        data = Buffer.concat([data, chunk]);
        const end = data.indexOf(0);
        if (end !== -1) resolve(data.subarray(0, end).toString("utf8"));
      });
      socket.once("end", () => {
        resolve(data.toString("utf8"));
      });
      socket.once("error", (error) => {
        reject(new ScannerUnavailableError(`The scanner failed: ${error.message}`));
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new ScannerUnavailableError("The scanner didn't answer in time"));
      });
    });
  }

  private write(socket: Socket, data: Buffer): Promise<void> {
    if (socket.write(data)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        socket.off("drain", onDrain);
        reject(new ScannerUnavailableError(`The scanner failed: ${error.message}`));
      };
      const onDrain = () => {
        socket.off("error", onError);
        resolve();
      };
      socket.once("drain", onDrain);
      socket.once("error", onError);
    });
  }

  async ping(): Promise<void> {
    const socket = await this.open();
    try {
      const answer = this.reply(socket);
      await this.write(socket, Buffer.from("zPING\0"));
      if ((await answer).trim() !== "PONG")
        throw new ScannerUnavailableError("Unexpected PING reply");
    } finally {
      socket.destroy();
    }
  }

  async scan(content: Readable): Promise<ScanVerdict> {
    const socket = await this.open();
    try {
      const answer = this.reply(socket);
      await this.write(socket, Buffer.from("zINSTREAM\0"));
      const size = Buffer.alloc(4);
      for await (const piece of content) {
        const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as string);
        if (chunk.length === 0) continue;
        size.writeUInt32BE(chunk.length, 0);
        await this.write(socket, Buffer.concat([size, chunk]));
      }
      await this.write(socket, Buffer.alloc(4));
      return parseVerdict(await answer);
    } finally {
      socket.destroy();
    }
  }
}

export function parseVerdict(reply: string): ScanVerdict {
  const text = reply.trim();
  if (text === "stream: OK") return { verdict: "clean" };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found?.[1]) return { verdict: "infected", signature: found[1] };
  // "INSTREAM size limit exceeded. ERROR" and anything else.
  throw new ScannerUnavailableError(`Unexpected scanner reply: ${text.slice(0, 120)}`);
}
