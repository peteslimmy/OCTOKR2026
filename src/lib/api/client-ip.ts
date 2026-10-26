/**
 * The address a request really came from, for the per-address sign-in limits (audit finding F-011).
 *
 * `X-Forwarded-For` is a list: the original client first, then one entry added by each proxy the request passed through. Everything to
 * the LEFT of the entries our own proxies added is whatever the client chose to send, so a limiter that reads the first entry can be
 * defeated by sending a fresh made-up address with every attempt. Counting from the right by the number of proxies we trust
 * (TRUSTED_PROXY_HOPS, default 1: one reverse proxy or load balancer in front of the app) gives the address that proxy observed.
 *
 * With TRUSTED_PROXY_HOPS=0 the header is ignored altogether (the app is exposed directly); every caller then shares one bucket, which is
 * safe but coarse, and the per-account limit still applies.
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

const LOOKS_LIKE_AN_ADDRESS = /^[0-9a-fA-F:.]{2,45}$/;

export function clientIp(req: Request, hops = trustedProxyHops()): string {
  if (hops === 0) return "direct";
  const entries = (req.headers.get("x-forwarded-for") ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return "direct";
  const entry = entries[Math.max(0, entries.length - hops)];
  return LOOKS_LIKE_AN_ADDRESS.test(entry) ? entry : "invalid";
}
