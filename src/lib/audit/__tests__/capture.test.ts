import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ userClient: async () => ({}) }));

import { clientIp } from "@/lib/api/client-ip";
import { auditHeaders, geoFrom, type AuditContext } from "../context";
import { canSeeAuditDetail } from "../detail";

const req = (h: Record<string, string>) => new Request("https://okr.example.test/api/v1/x", { headers: h });
const ON_VERCEL = { VERCEL: "1" };

describe("where a request came from (ADR-121)", () => {
  it("takes country, region and city from the platform's headers when the platform is trusted, folding accents", () => {
    const g = geoFrom(req({ "x-vercel-ip-country": "NG", "x-vercel-ip-country-region": "LA", "x-vercel-ip-city": "S%C3%A3o%20Paulo" }), ON_VERCEL);
    expect(g).toEqual({ country: "NG", region: "LA", city: "Sao Paulo" });
  });
  it("ignores the headers everywhere else, because a client could write them itself", () => {
    expect(geoFrom(req({ "x-vercel-ip-country": "NG", "x-vercel-ip-city": "Lagos" }), {})).toBeNull();
    expect(geoFrom(req({ "x-vercel-ip-country": "NG" }), { TRUST_GEO_HEADERS: "true" })).toEqual({ country: "NG", region: null, city: null });
  });
  it("records nothing when the platform sent nothing", () => {
    expect(geoFrom(req({}), ON_VERCEL)).toBeNull();
  });
  it("passes the location to the database as plain ASCII headers", () => {
    const ctx: AuditContext = { ip: "203.0.113.5", userAgent: "UA", requestId: "r1", channel: "WEB", sessionRef: null, geo: { country: "NG", region: "LA", city: "Lagos" } };
    expect(auditHeaders(ctx)).toMatchObject({ "x-audit-ip": "203.0.113.5", "x-audit-geo-country": "NG", "x-audit-geo-region": "LA", "x-audit-geo-city": "Lagos" });
    expect(auditHeaders({ ...ctx, geo: null })).not.toHaveProperty("x-audit-geo-city");
  });
});

describe("the client address", () => {
  it("still comes from the forwarded list, counted from the right", () => {
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.1, 203.0.113.9" }), 1)).toBe("203.0.113.9");
  });
  it("falls back to the platform's own header only where that platform is trusted", () => {
    const r = req({ "x-vercel-forwarded-for": "203.0.113.7" });
    const saved = process.env.VERCEL;
    try {
      delete process.env.VERCEL; delete process.env.TRUST_GEO_HEADERS;
      expect(clientIp(r, 1)).toBe("direct");
      process.env.VERCEL = "1";
      expect(clientIp(r, 1)).toBe("203.0.113.7");
      expect(clientIp(req({ "x-forwarded-for": "not-an-address", "x-vercel-forwarded-for": "203.0.113.7" }), 1)).toBe("203.0.113.7");
    } finally { if (saved === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved; }
  });
});

describe("who may read the technical detail of the audit log", () => {
  const who = (roles: string[], perms: string[]) => ({ roles, permissions: new Set(perms) });
  it("only a Super Admin who holds audit.read_detail", () => {
    expect(canSeeAuditDetail(who(["SUPER_ADMIN"], ["audit.read", "audit.read_detail"]))).toBe(true);
    expect(canSeeAuditDetail(who(["ADMIN"], ["audit.read"]))).toBe(false);
    expect(canSeeAuditDetail(who(["SUPER_ADMIN"], ["audit.read"]))).toBe(false);
    expect(canSeeAuditDetail(who(["ADMIN"], ["audit.read", "audit.read_detail"]))).toBe(false);
  });
});
