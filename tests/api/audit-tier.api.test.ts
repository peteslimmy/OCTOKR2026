/**
 * The audit log has a summary tier (Admin) and a detail tier (Super Admin), and every audited change records where it came from (ADR-121).
 * Needs the built app, the seeded test stack, and the app started with TRUST_GEO_HEADERS=true (the test sends location headers the way the hosting platform does):
 *   TRUST_GEO_HEADERS=true node scripts/test-stack.mjs run --seed -- node scripts/run-api-tests.mjs audit-tier
 */
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { loginAs } from "./session";

const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const GEO = { "x-vercel-ip-country": "NG", "x-vercel-ip-country-region": "LA", "x-vercel-ip-city": "Lagos" };
const DETAIL_KEYS = ["ip_address", "user_agent", "ip_trusted", "browser", "os", "device", "request_id", "session_ref", "correlation_id", "workflow_id", "old_values", "new_values", "metadata", "chain_seq", "row_hash", "actor_email"];

describe("audit log tiers and capture", () => {
  it("every audited change made through the app records the address, the device and the location", async () => {
    const admin = await loginAs("admin@4core.local");
    const bus = (await admin.request("GET", "/api/v1/business-units")).json.data as { id: string }[];
    const email = `capture-${Date.now()}@4core.local`;
    const started = new Date(Date.now() - 2000).toISOString();
    const created = await admin.request("POST", "/api/v1/users", { email, firstName: "Cap", lastName: "Ture", businessUnitId: bus[0].id, roles: ["BU_LEAD"] }, GEO);
    expect(created.status).toBe(200);
    const id = (created.json.data as { id: string }).id;
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    try {
      expect((await admin.request("POST", `/api/v1/users/${id}/invite`, undefined, GEO)).status).toBe(200);        // an audited write made by server code outside the request helper
      expect((await admin.request("POST", `/api/v1/users/${id}/suspend`, undefined, GEO)).status).toBe(200);
      const rows = (await db.query(
        `select action, ip_address, user_agent, metadata->'geo' as geo from audit_logs where occurred_at >= $1 and (entity_id = $2 or action like 'USER_INVITATION_%') and action not like 'AUTH_%' order by seq`, [started, id])).rows as
        { action: string; ip_address: string | null; user_agent: string | null; geo: { city?: string; country?: string; trusted?: boolean } | null }[];
      const actions = rows.map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["USER_INVITATION_SENT"]));
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const r of rows) {
        expect(r.ip_address, `${r.action} address`).toBeTruthy();
        expect(r.user_agent, `${r.action} device`).toBeTruthy();
        expect(r.geo, `${r.action} location`).toMatchObject({ city: "Lagos", country: "NG", trusted: true });
      }
    } finally {
      await admin.request("DELETE", `/api/v1/users/${id}/delete`, { reason: "audit capture test clean-up" });
      await db.end();
    }
  });

  it("an Admin reads the summary of the log, a Super Admin reads the detail", async () => {
    const admin = await loginAs("admin@4core.local");
    const sa = await loginAs("superadmin@4core.local");
    const a = await admin.request("GET", "/api/v1/audit?limit=60");
    expect(a.status).toBe(200);
    const arows = (a.json.data as { rows: Record<string, unknown>[] }).rows;
    expect(arows.length).toBeGreaterThan(0);
    for (const k of DETAIL_KEYS) for (const r of arows) expect(r, k).not.toHaveProperty(k);
    expect(arows[0]).toHaveProperty("action");
    expect(arows[0]).toHaveProperty("actor_name");

    const s = await sa.request("GET", "/api/v1/audit?limit=60");
    const srows = (s.json.data as { rows: Record<string, unknown>[] }).rows;
    expect(srows.some((r) => typeof r.ip_address === "string")).toBe(true);
    expect(srows.some((r) => r.metadata && typeof r.metadata === "object")).toBe(true);
  });

  it("filters on detail columns are ignored for an Admin, and the event trace is the summary", async () => {
    const admin = await loginAs("admin@4core.local");
    const all = (await admin.request("GET", "/api/v1/audit?limit=5")).json.data as { rows: { id: string }[] };
    const filtered = await admin.request("GET", "/api/v1/audit?limit=5&ip=198.51.100.99&session=zzzz&request=zzzz");
    expect(filtered.status).toBe(200);
    expect((filtered.json.data as { rows: unknown[] }).rows.length).toBe(all.rows.length);          // not narrowed by a column the Admin may not read
    const trace = await admin.request("GET", `/api/v1/audit/events/${all.rows[0].id}`);
    expect(trace.status).toBe(200);
    const ev = (trace.json.data as { event: Record<string, unknown>; chain: unknown }).event;
    for (const k of DETAIL_KEYS) expect(ev, k).not.toHaveProperty(k);
    expect((trace.json.data as { chain: unknown }).chain).toBeNull();
  });

  it("the CSV an Admin exports has the summary columns only; a Super Admin's has the address and the location", async () => {
    const admin = await loginAs("admin@4core.local");
    const sa = await loginAs("superadmin@4core.local");
    const a = await admin.request("GET", "/api/v1/audit/export?format=csv");
    expect(a.status).toBe(200);
    const aHead = a.text.split(/\r?\n/)[0];
    expect(aHead).toContain("action");
    for (const col of ["ip_address", "location", "browser", "session_ref", "request_id", "old_values", "new_values", "row_hash", "actor_email"]) expect(aHead, col).not.toContain(col);
    const s = await sa.request("GET", "/api/v1/audit/export?format=csv");
    const sHead = s.text.split(/\r?\n/)[0];
    for (const col of ["ip_address", "location", "browser", "old_values", "row_hash"]) expect(sHead, col).toContain(col);
  });

  it("checking the integrity chain is for the Super Admin only", async () => {
    const admin = await loginAs("admin@4core.local");
    const sa = await loginAs("superadmin@4core.local");
    expect((await admin.request("POST", "/api/v1/audit/verify")).status).toBe(403);
    expect((await sa.request("POST", "/api/v1/audit/verify")).status).toBe(200);
  });
});
