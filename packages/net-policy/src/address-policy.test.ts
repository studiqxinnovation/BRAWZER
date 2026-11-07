import { describe, expect, it } from "vitest";
import { isObviouslyLocal, isPublicAddress, parseHost } from "./address-policy.ts";

describe("isPublicAddress", () => {
  it("allows ordinary public addresses", () => {
    for (const address of [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "2606:4700:4700::1111",
      "2a00:1450:4001::200e",
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("refuses private, local and special-purpose IPv4", () => {
    for (const address of [
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.1",
      "100.64.0.1",
      "100.100.100.200",
      "127.0.0.1",
      "127.255.255.254",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.192",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.9",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("refuses private, local and disguised IPv6", () => {
    for (const address of [
      "::",
      "::1",
      "0:0:0:0:0:0:0:1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:8.8.8.8",
      "::127.0.0.1",
      "64:ff9b::7f00:1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      "2001:db8::1",
      "2002:7f00:1::1",
      "fc00::1",
      "fd00:ec2::254",
      "fe80::1",
      "fec0::1",
      "ff02::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("refuses anything that isn't a plain address", () => {
    for (const value of [
      "",
      "localhost",
      "fe80::1%en0",
      "127.1",
      "2130706433",
      "0x7f000001",
      "1.2.3.4.5",
    ]) {
      expect(isPublicAddress(value), value).toBe(false);
    }
  });
});

describe("parseHost", () => {
  it("reads addresses and host names", () => {
    expect(parseHost(" Proxy.Example.COM ")).toEqual({ kind: "name", name: "proxy.example.com" });
    expect(parseHost("proxy.example.com.")).toEqual({ kind: "name", name: "proxy.example.com" });
    expect(parseHost("93.184.216.34")).toEqual({ kind: "ip", address: "93.184.216.34", family: 4 });
    expect(parseHost("[2606:4700::1111]")).toEqual({
      kind: "ip",
      address: "2606:4700::1111",
      family: 6,
    });
    expect(parseHost("bücher.example")).toEqual({ kind: "name", name: "xn--bcher-kva.example" });
  });

  it("refuses numeric and hex shorthands a resolver might expand", () => {
    for (const value of [
      "2130706433",
      "0177.0.0.1",
      "0x7f.0.0.1",
      "0x7f000001",
      "127.1",
      "127.0.1",
      "01.02.03.04",
      "1.2.3.4.5",
      "256.1.1.1",
      "example.123",
    ]) {
      expect(parseHost(value), value).toBeNull();
    }
  });

  it("refuses malformed names and zone IDs", () => {
    for (const value of [
      "",
      " ",
      "-bad.example",
      "bad-.example",
      "a..b",
      "under_score.example",
      "fe80::1%en0",
      "[::1",
      "x".repeat(254),
    ]) {
      expect(parseHost(value), value).toBeNull();
    }
  });
});

describe("isObviouslyLocal", () => {
  it("flags local names and private addresses", () => {
    for (const value of [
      "localhost",
      "db.localhost",
      "printer.local",
      "api.internal",
      "nas.home.arpa",
      "router.lan",
      "127.0.0.1",
      "::1",
      "10.1.2.3",
    ]) {
      const host = parseHost(value);
      expect(host, value).not.toBeNull();
      if (host) expect(isObviouslyLocal(host), value).toBe(true);
    }
    const ordinary = parseHost("proxy.example.com");
    expect(ordinary && isObviouslyLocal(ordinary)).toBe(false);
  });
});
