import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ userClient: async () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }));
import { auditHeaders, buildAuditContext } from "../context";
import { auditPdf, watText } from "../export-pdf";
import { filterFrom, filterParams, filterRange, plain } from "@/lib/data/audit";

const req = (h: Record<string, string>) => new Request("https://app.test/api/v1/x", { headers: h });

describe("audit request context (ADR-108)", () => {
  it("takes the client address from the right of X-Forwarded-For, so a client-supplied first entry is ignored", async () => {
    const ctx = await buildAuditContext(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9", "user-agent": "Mozilla/5.0 Chrome/120" }), false);
    expect(ctx.ip).toBe("203.0.113.9");
    expect(ctx.channel).toBe("WEB");
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(auditHeaders(ctx)).toMatchObject({ "x-audit-ip": "203.0.113.9", "x-audit-ua": "Mozilla/5.0 Chrome/120", "x-audit-channel": "WEB" });
  });
  it("marks bearer-token calls as API, leaves the address out when it cannot be trusted, and strips control characters from the user agent", async () => {
    const ctx = await buildAuditContext(req({ authorization: "Bearer abc" }), false);
    expect(ctx.channel).toBe("API");
    expect(ctx.ip).toBeNull();
    expect(auditHeaders(ctx)["x-audit-ip"]).toBeUndefined();
    const h = auditHeaders({ ...ctx, userAgent: "bad" + String.fromCharCode(13, 10) + "x-evil: 1" });
    expect(h["x-audit-ua"]).toBe("bad??x-evil: 1");
  });
  it("sends nothing when there is no context", () => { expect(auditHeaders(undefined)).toEqual({}); });
});

describe("audit filters", () => {
  it("round-trips every filter through the query string and drops characters that mean something to the filter language", () => {
    const f = filterFrom(new URLSearchParams("action=ROLE_&type=role&entity=1&outcome=DENIED&severity=HIGH&category=SECURITY&actor=ann&role=ADMIN&bu=Eng&ip=1.2.3.4&session=s&request=r&channel=WEB&from=2026-01-01&to=2026-02-01&q=x"));
    expect(Object.keys(f)).toHaveLength(16);
    expect(filterFrom(filterParams(f))).toEqual(f);
    const cleaned = plain("x),action.neq.zzz,(y%*" + String.fromCharCode(34, 39, 92));
    for (const ch of [",", "(", ")", "%", "*", String.fromCharCode(34), String.fromCharCode(39), String.fromCharCode(92)]) expect(cleaned).not.toContain(ch);
  });
  it("reads a Lagos calendar day as UTC+1 and the end date inclusively", () => {
    expect(filterRange({ from: "2026-03-01", to: "2026-03-02" })).toEqual({ from: "2026-03-01T00:00:00+01:00", to: "2026-03-03T00:00:00+01:00" });
  });
});

describe("audit PDF export", () => {
  it("produces a PDF whose times are shown in West Africa Time", async () => {
    expect(watText("2026-03-01T23:30:00Z")).toContain("02 Mar 2026, 00:30:00 WAT");
    const pdf = await auditPdf({ generatedAt: "2026-03-01T10:00:00Z", generatedFor: "A (a@x)", filterText: "", truncated: false, chainNote: "ok",
      rows: [{ id: "1", seq: 1, occurred_at: "2026-03-01T10:00:00Z", action: "ROLE_CREATED", outcome: "SUCCESS", entity_type: "role", entity_id: "r", old_values: null, new_values: { a: 1 } } as never] });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
