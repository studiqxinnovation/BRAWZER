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
    expect(rules).toContain("169.254.0.0/16");
    // The private-range drop comes before the egress user's accept, so even that process is bound by it.
    expect(rules.indexOf("ip daddr {")).toBeLessThan(rules.indexOf("meta skuid"));
  });

  it("keeps private ranges reachable only in development", () => {
    expect(firewallRules({ uid: 10002, allowPrivate: true })).not.toContain("ip daddr {");
  });
});
