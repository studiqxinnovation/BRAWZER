import http from "node:http";
import { readConfig } from "./config.ts";
import { applyFirewall } from "./firewall.ts";
import { log } from "./log.ts";
import { createEgressProxy } from "./proxy.ts";
import { createTesterServer } from "./tester-server.ts";

const config = readConfig(process.env);

// The firewall needs CAP_NET_ADMIN, so the container starts this process as
// root; it drops to an unprivileged user before opening any socket.
if (config.firewall) {
  await applyFirewall({ uid: config.runAs.uid, allowPrivate: config.allowPrivate });
  log("info", "firewall applied", { uid: config.runAs.uid });
}
if (process.getuid?.() === 0) {
  process.setgroups?.([]);
  process.setgid?.(config.runAs.gid);
  process.setuid?.(config.runAs.uid);
}
if (process.getuid?.() === 0) throw new Error("The egress service must not run as root");

if (config.mode === "tester") {
  const server = createTesterServer({
    secret: config.secret,
    allowPrivate: config.allowPrivate,
    loopbackHost: config.loopbackHost,
  });
  await new Promise<void>((resolve) => server.listen(config.port, "0.0.0.0", resolve));
  log("info", "egress tester ready", { port: config.port });
} else {
  const proxy = createEgressProxy({
    upstream: config.upstream,
    allowPrivate: config.allowPrivate,
    loopbackHost: config.loopbackHost,
    onRefused: (target, reason) => log("info", "refused", { target: target.slice(0, 253), reason }),
  });
  await new Promise<void>((resolve) => proxy.listen(config.proxyPort, "127.0.0.1", resolve));
  const health = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => health.listen(config.port, "0.0.0.0", resolve));
  log("info", "egress ready", { proxyPort: config.proxyPort, port: config.port });
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log("info", "egress exiting", { signal });
    process.exit(0);
  });
}
