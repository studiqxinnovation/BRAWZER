import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { ProxyTester } from "@brawzer/proxy-client";
import { z } from "zod";
import { log } from "./log.ts";
import { rewriteLoopback } from "./proxy.ts";

const MAX_BODY = 16 * 1024;

const testRequestSchema = z.object({
  target: z.object({
    protocol: z.enum(["http", "https", "socks4", "socks4a", "socks5"]),
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
    credentials: z
      .object({ username: z.string().max(255), password: z.string().max(255) })
      .nullable(),
  }),
  /** Where the test fetches from, through the proxy; the API decides. */
  echoUrl: z.url({ protocol: /^https?$/ }),
});

function authorized(header: string | undefined, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Runs proxy tests for the API (ADR 0010, moved out of the API process by
 * ADR 0014). One route, authenticated with the secret the API started this
 * container with; the API applies its own rate limits before calling.
 */
export function createTesterServer(options: {
  secret: string;
  allowPrivate: boolean;
  loopbackHost: string | null;
}): http.Server {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (!authorized(req.headers.authorization, options.secret)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/test") {
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      let parsed: z.infer<typeof testRequestSchema>;
      try {
        parsed = testRequestSchema.parse(JSON.parse(await readBody(req)));
      } catch {
        res.writeHead(400, { "content-type": "application/json" }).end('{"error":"bad request"}');
        return;
      }
      // The echo is fetched through the proxy, which reaches it from its own
      // network; only the proxy's own address is rewritten for development.
      const echoUrl = new URL(parsed.echoUrl);
      const tester = new ProxyTester({ echoUrl, allowPrivate: options.allowPrivate });
      const outcome = await tester.test(rewriteLoopback(parsed.target, options.loopbackHost));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(outcome));
    })().catch((error: unknown) => {
      log("warn", "test failed", { message: error instanceof Error ? error.message : "" });
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
}
