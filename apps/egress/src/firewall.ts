import { spawn } from "node:child_process";

export interface FirewallOptions {
  /** The user the egress process runs as: the only one allowed out. */
  uid: number;
  /** Development and tests only: private addresses stay reachable (test proxies on the host). */
  allowPrivate: boolean;
}

/**
 * The nftables rules for the session's network namespace, which the runtime
 * container shares: nothing leaves except through the egress process. The
 * engine's own sockets (another user) can only reach loopback, so even a
 * compromised engine has no route to the internet, the host or Brawzer's
 * services, and no DNS of its own. Replies to connections the host opened
 * (the agent's port) are allowed back out.
 */
export function firewallRules(options: FirewallOptions): string {
  const privateRanges = options.allowPrivate
    ? ""
    : `
    ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.168.0.0/16, 198.18.0.0/15, 224.0.0.0/3 } oif != "lo" drop
    ip6 daddr { ::1/128, fc00::/7, fe80::/10, ff00::/8, ::ffff:0:0/96, 64:ff9b::/96, 2002::/16, 2001::/32 } oif != "lo" drop`;
  // Only Brawzer's own table is replaced: the namespace also holds the
  // engine's NAT rules for its embedded DNS, which must stay.
  return `add table inet brawzer
delete table inet brawzer
table inet brawzer {
  chain input {
    type filter hook input priority 0; policy accept;
  }
  chain output {
    type filter hook output priority 0; policy drop;
    oif "lo" accept
    ct state established,related accept${privateRanges}
    meta skuid ${String(options.uid)} accept
  }
}
`;
}

/** Applies the rules with `nft`. Needs CAP_NET_ADMIN; the process drops to `uid` afterwards. */
export function applyFirewall(options: FirewallOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("nft", ["-f", "-"], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (line: string) => {
      stderr += line;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`nft exited with ${String(code)}: ${stderr.trim().slice(0, 300)}`));
    });
    child.stdin.end(firewallRules(options));
  });
}
