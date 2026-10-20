import { afterEach, describe, expect, it } from "vitest";
import { UnsafeAddressError, assertPublicHost, assertPublicUrl, isPrivateAddress } from "../ssrf";

afterEach(() => { delete process.env.INTEGRATIONS_ALLOW_PRIVATE_HOSTS; });

describe("which addresses an integration may connect to", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "2001:db8::1", "not an address",
  ])("refuses %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.255.255", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it("checks a literal address without a lookup and says why it refuses", async () => {
    await expect(assertPublicHost("169.254.169.254")).rejects.toThrow(/private or internal address/);
    await expect(assertPublicHost("[::1]")).rejects.toThrow(UnsafeAddressError);
    await expect(assertPublicHost("")).rejects.toThrow(/empty/);
    await expect(assertPublicHost("8.8.8.8")).resolves.toBeUndefined();
  });

  it("refuses web addresses that are not plain https to a public host", async () => {
    await expect(assertPublicUrl("http://8.8.8.8/hook")).rejects.toThrow(/https/);
    await expect(assertPublicUrl("https://user:pass@8.8.8.8/hook")).rejects.toThrow(/user name or password/);
    await expect(assertPublicUrl("ftp://8.8.8.8/")).rejects.toThrow(/https/);
    await expect(assertPublicUrl("not a url")).rejects.toThrow(/valid web address/);
    await expect(assertPublicUrl("https://127.0.0.1:8443/x")).rejects.toThrow(/private or internal/);
    await expect(assertPublicUrl("https://8.8.8.8/hook")).resolves.toBeInstanceOf(URL);
  });

  it("can be switched off for development, and only that way", async () => {
    process.env.INTEGRATIONS_ALLOW_PRIVATE_HOSTS = "true";
    await expect(assertPublicUrl("http://127.0.0.1:9000/hook")).resolves.toBeInstanceOf(URL);
    await expect(assertPublicHost("10.0.0.1")).resolves.toBeUndefined();
    process.env.INTEGRATIONS_ALLOW_PRIVATE_HOSTS = "1";
    await expect(assertPublicHost("10.0.0.1")).rejects.toThrow();
  });
});
