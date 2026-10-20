import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Where an integration may point (ADR-076). An administrator types a web address or a server name; the application then connects to it from inside
 * your network. Without a check that is a way to make the server call things only it can reach (cloud metadata, internal admin pages, the database).
 * So an address must be public: not loopback, private, link-local, shared (CGNAT), multicast, unspecified or reserved, in IPv4 or IPv6, and every address
 * the name resolves to is checked, not just the first. The check runs when a change is asked for and again before every delivery.
 *
 * Residual risk, stated plainly: DNS can answer differently between the check and the connection (rebinding). Redirects are never followed, which closes
 * the easier route. Where this matters most, also restrict the application's outbound network at the host.
 * INTEGRATIONS_ALLOW_PRIVATE_HOSTS=true switches the check off, for development and the automated tests only; health reports it if set in production.
 */
export class UnsafeAddressError extends Error {}

export const allowPrivateHosts = () => process.env.INTEGRATIONS_ALLOW_PRIVATE_HOSTS === "true";

function ipv4ToInt(ip: string): number { return ip.split(".").reduce((n, p) => n * 256 + Number(p), 0); }
const inRange = (n: number, base: string, bits: number) => { const b = ipv4ToInt(base); const size = 2 ** (32 - bits); return n >= b && n < b + size; };
const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** True for any address that is not an ordinary public one. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) { const n = ipv4ToInt(ip); return V4_BLOCKS.some(([b, bits]) => inRange(n, b, bits)); }
  if (v === 6) {
    const a = ip.toLowerCase();
    const mapped = a.match(/^(?:0{0,4}:){0,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/) ?? a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (a === "::" || a === "::1") return true;
    if (/^f[cd]/.test(a)) return true;                       // fc00::/7 unique local
    if (/^fe[89ab]/.test(a)) return true;                    // fe80::/10 link local
    if (/^ff/.test(a)) return true;                          // multicast
    if (a.startsWith("2001:db8")) return true;               // documentation
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(a)) return true;   // IPv4-mapped in hex form: refuse rather than decode
    return false;
  }
  return true;                                               // not an address at all
}

async function addressesOf(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  try { return (await lookup(host, { all: true, verbatim: true })).map((r) => r.address); }
  catch { throw new UnsafeAddressError(`The name ${host} could not be found. Check the spelling and that it is reachable from the server.`); }
}

/** Throws UnsafeAddressError, with a plain reason, unless the host resolves only to public addresses. */
export async function assertPublicHost(host: string): Promise<void> {
  const h = host.trim().replace(/^\[|\]$/g, "");
  if (!h) throw new UnsafeAddressError("The server name is empty.");
  if (allowPrivateHosts()) { await addressesOf(h); return; }
  const addrs = await addressesOf(h);
  if (addrs.length === 0) throw new UnsafeAddressError(`The name ${h} did not resolve to any address.`);
  const bad = addrs.find(isPrivateAddress);
  if (bad) throw new UnsafeAddressError(`${h} points to a private or internal address (${bad}). Integrations may only connect to public servers.`);
}

/** A web address an integration may call: https (http only where private hosts are allowed), no embedded credentials, public host. Returns the parsed URL. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeAddressError("That is not a valid web address."); }
  if (u.username || u.password) throw new UnsafeAddressError("Do not put a user name or password in the address; use the secret fields.");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && allowPrivateHosts())) throw new UnsafeAddressError("The address must start with https://.");
  await assertPublicHost(u.hostname);
  return u;
}
