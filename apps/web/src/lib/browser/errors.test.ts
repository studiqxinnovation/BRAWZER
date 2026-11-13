import { describe, expect, it } from "vitest";
import { describeNavigationError, navigationErrorKind } from "./errors";

describe("navigation errors", () => {
  it("sorts both engines' codes into what they mean", () => {
    expect(navigationErrorKind("ERR_NAME_NOT_RESOLVED")).toBe("unresolved");
    expect(navigationErrorKind("dnsNotFound")).toBe("unresolved");
    expect(navigationErrorKind("ERR_TUNNEL_CONNECTION_FAILED")).toBe("blocked");
    expect(navigationErrorKind("proxyConnectFailure")).toBe("blocked");
    expect(navigationErrorKind("ERR_CONNECTION_REFUSED")).toBe("unreachable");
    expect(navigationErrorKind("ERR_CONNECTION_TIMED_OUT")).toBe("timeout");
    expect(navigationErrorKind("netTimeout")).toBe("timeout");
    expect(navigationErrorKind("ERR_CERT_DATE_INVALID")).toBe("certificate");
    expect(navigationErrorKind("nssBadCert")).toBe("certificate");
    expect(navigationErrorKind("SSL_ERROR_BAD_CERT_DOMAIN")).toBe("certificate");
    expect(navigationErrorKind("nssFailure2")).toBe("secure");
    expect(navigationErrorKind("ERR_SSL_PROTOCOL_ERROR")).toBe("secure");
    expect(navigationErrorKind("SSL_ERROR_NO_CYPHER_OVERLAP")).toBe("secure");
    expect(navigationErrorKind("ERR_TOO_MANY_REDIRECTS")).toBe("redirect");
    expect(navigationErrorKind("ERR_UNKNOWN_URL_SCHEME")).toBe("address");
    expect(navigationErrorKind("BRAWZER_REFUSED_UNRESOLVED")).toBe("unresolved");
    expect(navigationErrorKind("BRAWZER_REFUSED_ADDRESS")).toBe("blocked");
    expect(navigationErrorKind("BRAWZER_REFUSED_PORT")).toBe("blocked");
    expect(navigationErrorKind("BRAWZER_REFUSED_ENGINE")).toBe("blocked");
    expect(navigationErrorKind("BRAWZER_REFUSED_POLICY")).toBe("policy");
    expect(navigationErrorKind("ERR_SOMETHING_NEW")).toBe("other");
    expect(navigationErrorKind("")).toBe("other");
  });

  it("doesn’t blame a certificate for a handshake the site refused", () => {
    const text = describeNavigationError("nssFailure2", "https://whoer.net/");
    expect(text.title).toBe("A secure connection couldn’t be made");
    expect(text.detail).toContain("“whoer.net”");
    expect(text.detail).not.toMatch(/certificate/i);
  });

  it("names the host and never the engine", () => {
    const text = describeNavigationError("ERR_NAME_NOT_RESOLVED", "https://no-such.example/path");
    expect(text.title).toBe("There’s no website at this address");
    expect(text.detail).toContain("“no-such.example”");
    expect(text.detail).not.toMatch(/chrom|firefox|gecko/i);
    expect(describeNavigationError("ERR_INVALID_URL", "nonsense").detail).toContain(
      "Check the address",
    );
    expect(
      describeNavigationError("BRAWZER_REFUSED_PORT", "https://a.example:81/").detail,
    ).toContain("port Brawzer doesn’t carry");
    expect(describeNavigationError("BRAWZER_REFUSED_ADDRESS", "https://10.0.0.1/").detail).toBe(
      "“10.0.0.1” is a private or internal address. Brawzer only connects to public websites.",
    );
  });
});
