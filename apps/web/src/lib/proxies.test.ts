import { describe, expect, it } from "vitest";
import { fromDetails, hostAndPort, proxyFieldErrors } from "./proxies";

describe("proxy helpers", () => {
  it("writes IPv6 hosts in brackets", () => {
    expect(hostAndPort("proxy.example.com", 1080)).toBe("proxy.example.com:1080");
    expect(hostAndPort("2606:4700::1111", 8080)).toBe("[2606:4700::1111]:8080");
  });

  it("maps nested credential errors onto the form's own fields", () => {
    expect(
      proxyFieldErrors(
        fromDetails([
          "credentials.password: SOCKS4 proxies take a user ID only, not a password.",
          "host: Enter a host name.",
          "host: second message is ignored",
        ]),
      ),
    ).toEqual({
      password: "SOCKS4 proxies take a user ID only, not a password.",
      host: "Enter a host name.",
    });
  });
});
