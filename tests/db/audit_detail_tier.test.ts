import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

/** The audit log has a summary tier and a detail tier (ADR-121). */
async function world(c: Ctx) {
  const bu = await c.bu("TIERBU");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const admin = await c.user(["ADMIN"], bu, "admin");
  return { bu, sa, admin };
}
const headers = JSON.stringify({ "x-audit-ip": "203.0.113.7", "x-audit-ua": "Mozilla/5.0 (Windows NT 10.0) Chrome/120", "x-audit-geo-country": "NG", "x-audit-geo-region": "LA", "x-audit-geo-city": "Lagos" });

describe("audit log: summary for Admin, detail for Super Admin", () => {
  it("only the Super Admin holds audit.read_detail", async () => {
    await withTx(async (c) => {
      const holders = await c.q<{ code: string }>("select r.code from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id where p.code = 'audit.read_detail' order by 1");
      expect(holders.map((h) => h.code)).toEqual(["SUPER_ADMIN"]);
      const [p] = await c.q<{ protected: boolean; risk: string }>("select protected, risk from permissions where code = 'audit.read_detail'");
      expect(p).toEqual({ protected: true, risk: "critical" });
    });
  });

  it("an Admin can read the summary columns but not one detail column, even directly", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("select write_audit($1, 'TIER_TEST', 'thing', 'x1', '{\"a\":1}'::jsonb, '{\"a\":2}'::jsonb)", [w.sa]);
      await c.asUser(w.admin, async () => {
        const rows = await c.q("select id, seq, occurred_at, actor_name, actor_role, action, entity_type, entity_id, reason, outcome, severity, event_category, channel from audit_logs limit 3");
        expect(rows.length).toBeGreaterThanOrEqual(0);
      });
      for (const col of ["ip_address", "user_agent", "old_values", "new_values", "metadata", "session_ref", "request_id", "row_hash", "actor_email", "browser"]) {
        await c.asUser(w.admin, async () => { await c.q("savepoint s"); await expect(c.q(`select ${col} from audit_logs limit 1`), col).rejects.toThrow(/permission denied/i); await c.q("rollback to savepoint s"); });
      }
      await c.asUser(w.admin, async () => { await c.q("savepoint s"); await expect(c.q("select * from audit_logs limit 1")).rejects.toThrow(/permission denied/i); await c.q("rollback to savepoint s"); });
    });
  });

  it("the event trace gives an Admin the summary only, and a Super Admin everything", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("select write_audit($1, 'TIER_TRACE', 'thing', 'x2', '{\"a\":1}'::jsonb, '{\"a\":2}'::jsonb)", [w.admin]);
      const id = (await c.q<{ id: string }>("select id from audit_logs where action = 'TIER_TRACE'"))[0].id;
      const forAdmin = await c.rpc<{ event: Record<string, unknown>; chain: unknown }>("audit_centre_trace", w.admin, id);
      expect(forAdmin.event.action).toBe("TIER_TRACE");
      for (const k of ["ip_address", "user_agent", "old_values", "new_values", "metadata", "session_ref", "request_id", "row_hash", "chain_seq", "browser", "actor_email"]) expect(forAdmin.event, k).not.toHaveProperty(k);
      expect(forAdmin.chain).toBeNull();
      const forSuper = await c.rpc<{ event: Record<string, unknown>; chain: unknown }>("audit_centre_trace", w.sa, id);
      expect(forSuper.event).toHaveProperty("old_values");
      expect(forSuper.chain).not.toBeNull();
    });
  });

  it("records the network address, the device and the location, and the hash chain still verifies", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("select set_config('request.headers', $1, true)", [headers]);
      await c.q("select write_audit($1, 'TIER_GEO', 'thing', 'x3', null, '{}'::jsonb)", [w.admin]);
      await c.q("select set_config('request.headers', '', true)");
      const [row] = await c.q<{ ip_address: string; browser: string; geo: { country: string; region: string; city: string; trusted: boolean } }>("select ip_address, browser, metadata->'geo' as geo from audit_logs where action = 'TIER_GEO'");
      expect(row.ip_address).toBe("203.0.113.7");
      expect(row.browser).toBeTruthy();
      expect(row.geo).toEqual({ country: "NG", region: "LA", city: "Lagos", trusted: true });
      const verify = await c.rpc<{ ok: boolean }>("audit_verify_chain", 1);
      expect(verify.ok).toBe(true);
    });
  });

  it("a request without location headers records none", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-audit-ip": "203.0.113.8" })]);
      await c.q("select write_audit($1, 'TIER_NOGEO', 'thing', 'x4', null, '{}'::jsonb)", [w.admin]);
      await c.q("select set_config('request.headers', '', true)");
      const [row] = await c.q<{ geo: unknown }>("select metadata->'geo' as geo from audit_logs where action = 'TIER_NOGEO'");
      expect(row.geo).toBeNull();
    });
  });
});
