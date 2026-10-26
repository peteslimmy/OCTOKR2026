import { describe, expect, it } from "vitest";
import { clientIp, trustedProxyHops } from "../client-ip";

const req = (xff?: string) => new Request("http://x.test/", { headers: xff === undefined ? {} : { "x-forwarded-for": xff } });

describe("the client address used by the sign-in limits (F-011)", () => {
  it("with one trusted proxy, uses the address that proxy added (the last entry)", () => {
    expect(clientIp(req("203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientIp(req("203.0.113.9, 10.0.0.2"), 1)).toBe("10.0.0.2");
  });

  it("ignores addresses the client prepended: a made-up first entry does not change the answer", () => {
    const real = "198.51.100.7";
    expect(clientIp(req(`1.2.3.4, ${real}`), 1)).toBe(real);
    expect(clientIp(req(`9.9.9.9, 8.8.8.8, ${real}`), 1)).toBe(real);
  });

  it("with two trusted proxies, counts two entries from the right", () => {
    expect(clientIp(req("evil, 198.51.100.7, 10.0.0.2"), 2)).toBe("198.51.100.7");
    expect(clientIp(req("10.0.0.2"), 2)).toBe("10.0.0.2");    // fewer entries than hops: the leftmost there is
  });

  it("ignores the header entirely when no proxy is trusted", () => {
    expect(clientIp(req("1.2.3.4"), 0)).toBe("direct");
  });

  it("falls back safely when the header is missing, empty or not an address", () => {
    expect(clientIp(req(), 1)).toBe("direct");
    expect(clientIp(req(""), 1)).toBe("direct");
    expect(clientIp(req("<script>"), 1)).toBe("invalid");
    expect(clientIp(req("a".repeat(100)), 1)).toBe("invalid");
  });

  it("reads TRUSTED_PROXY_HOPS and refuses nonsense", () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "0" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "2" })).toBe(2);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "-1" })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "abc" })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "99" })).toBe(1);
  });
});
