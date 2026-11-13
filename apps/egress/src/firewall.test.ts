import { describe, expect, it } from "vitest";
import { firewallRules } from "./firewall.ts";

describe("firewall rules", () => {
  it("lets only the egress user out, plus loopback and replies", () => {
    const rules = firewallRules({ uid: 10002, allowPrivate: false });
    expect(rules).toContain("policy drop");
    expect(rules).not.toContain("flush ruleset");
    expect(rules).toContain('oif "lo" accept');
    expect(rules).toContain("ct state established,related accept");
    expect(rules).toContain("meta skuid 10002 accept");
    // DNS is refused to everyone else, ahead of the container engine's NAT for
    // its embedded resolver on 127.0.0.11.
    expect(rules).toContain("th dport 53 meta skuid != 10002 drop");
    expect(rules).toContain("priority -300");
    expect(rules).toContain("169.254.0.0/16");
    // The private-range drop comes before the egress user's accept, so even that process is bound by it.
    expect(rules.indexOf("ip daddr {")).toBeLessThan(rules.indexOf("meta skuid 10002 accept"));
  });

  it("keeps private ranges reachable only in development", () => {
    expect(firewallRules({ uid: 10002, allowPrivate: true })).not.toContain("ip daddr {");
  });
});
