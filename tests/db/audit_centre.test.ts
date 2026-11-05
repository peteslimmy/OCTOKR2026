import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

const HEADERS = JSON.stringify({
  "x-audit-ip": "203.0.113.9", "x-audit-ua": "Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "x-audit-session": "sess-abc", "x-request-id": "req-1", "x-correlation-id": "corr-1",
});
type Row = Record<string, unknown>;
const last = async (c: Ctx): Promise<Row> => (await c.q<Row>("select * from audit_logs order by seq desc limit 1"))[0];

describe("event model: context, snapshot, classification, redaction", () => {
  it("fills request context, device, actor snapshot, category, severity and workflow from one place", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AC1");
      const sa = await c.user(["SUPER_ADMIN"], bu, "boss");
      await c.q("select set_config('request.headers', $1, true)", [HEADERS]);
      const reqId = "11111111-2222-3333-4444-555555555555";
      await c.rpc("write_audit", sa, "CONFIG_CHANGE_APPLIED", "config_change_request", reqId, null, { status: "APPLIED" }, "because", bu);
      const r = await last(c);
      expect(r).toMatchObject({
        ip_address: "203.0.113.9", ip_trusted: true, browser: "Chrome", os: "Windows", device: "Desktop", session_ref: "sess-abc", request_id: "req-1", correlation_id: "corr-1",
        channel: "WEB", event_category: "CONFIGURATION", severity: "MEDIUM", workflow_id: reqId, related_approval_id: reqId,
        actor_role: "SUPER_ADMIN", actor_bu_name: "BU AC1", actor_scope: "ORGANISATION", outcome: "SUCCESS",
      });
      expect(String(r.actor_name)).toContain("boss");
      expect(String(r.actor_email)).toContain("@test.local");
      expect(r.id).not.toBe(r.entity_id);                       // event id, record id and request id are separate fields
    });
  });

  it("marks system writes, keeps a refusal at least MEDIUM, and accepts the widened outcomes", async () => {
    await withTx(async (c) => {
      await c.rpc("write_audit", null, "JOB_FAILED", "job", "x", null, { error: "boom" }, null, null, "FAILURE");
      expect(await last(c)).toMatchObject({ channel: "BACKGROUND_JOB", event_category: "SYSTEM", severity: "HIGH", actor_scope: "SYSTEM", ip_trusted: false });
      await c.rpc("write_audit", null, "ATTENDANCE_AMENDMENT_SUBMITTED", "x", "1", null, null, null, null, "REJECTED");
      expect(await last(c)).toMatchObject({ outcome: "REJECTED", severity: "LOW", event_category: "ATTENDANCE_HR" });
      await c.rpc("write_audit", null, "REPORT_SUBMITTED", "x", "1", null, null, null, null, "PARTIAL");
      expect(await last(c)).toMatchObject({ outcome: "PARTIAL" });
      await c.expectError("new row for relation", () => c.rpc("write_audit", null, "REPORT_SUBMITTED", "x", "1", null, null, null, null, "MAYBE"));
    });
  });

  it("redacts secrets at any depth in old, new and metadata, but keeps ordinary values", async () => {
    await withTx(async (c) => {
      await c.rpc("write_audit", null, "INTEGRATION_UPDATED", "integration", "1",
        { api_key: "sk-live-1", keep: "yes" }, { config: { password: "p", token: "t", list: [{ client_secret: "s", name: "n" }] }, topic: "x", secrets_set: ["password"] });
      const r = await last(c);
      expect(r.old_values).toEqual({ api_key: "[REDACTED]", keep: "yes" });
      expect(r.new_values).toEqual({ config: { password: "[REDACTED]", token: "[REDACTED]", list: [{ client_secret: "[REDACTED]", name: "n" }] }, topic: "x", secrets_set: ["password"] });
      expect(JSON.stringify(await c.q("select * from audit_logs where id = $1", [r.id]))).not.toContain("sk-live-1");
    });
  });
});

describe("tamper evidence and DB-level permissions", () => {
  it("chains every new row to the previous one and verifies; a changed row or a removed row is found", async () => {
    await withTx(async (c) => {
      for (let i = 0; i < 4; i++) await c.rpc("write_audit", null, "REPORT_SUBMITTED", "report", String(i));
      const rows = await c.q<Row>("select chain_seq, prev_hash, row_hash from audit_logs where chain_seq is not null order by chain_seq");
      expect(rows.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].row_hash);
      expect(await c.rpc<{ ok: boolean }>("audit_verify_chain", 1)).toMatchObject({ ok: true });

      // an owner-level change (the trigger switched off, as a database administrator could) is still detected by the chain
      const target = rows[rows.length - 2].chain_seq as string;
      await c.q("alter table audit_logs disable trigger audit_logs_immutable");
      await c.q("update audit_logs set reason = 'edited' where chain_seq = $1", [target]);
      const bad = await c.rpc<{ ok: boolean; broken_chain_seq: string; problem: string }>("audit_verify_chain", 1);
      expect(bad).toMatchObject({ ok: false, problem: "CONTENT_CHANGED" });
      expect(Number(bad.broken_chain_seq)).toBe(Number(target));
      await c.q("update audit_logs set reason = null where chain_seq = $1", [target]);
      expect(await c.rpc<{ ok: boolean }>("audit_verify_chain", 1)).toMatchObject({ ok: true });
      await c.q("delete from audit_logs where chain_seq = $1", [target]);
      expect(await c.rpc<{ ok: boolean; problem: string }>("audit_verify_chain", 1)).toMatchObject({ ok: false, problem: "LINK_BROKEN" });
    });
  });

  it("records a failed verification as a CRITICAL event", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AC2");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      await c.rpc("write_audit", null, "REPORT_SUBMITTED", "report", "1");
      await c.rpc("write_audit", null, "REPORT_SUBMITTED", "report", "2");
      await c.q("alter table audit_logs disable trigger audit_logs_immutable");
      await c.q("update audit_logs set action = 'REPORT_REJECTED' where chain_seq = (select min(chain_seq) from audit_logs where entity_id = '1')");
      expect(await c.rpc<{ ok: boolean }>("audit_verify_and_record", sa)).toMatchObject({ ok: false });
      expect(await last(c)).toMatchObject({ action: "AUDIT_CHAIN_BROKEN", severity: "CRITICAL", outcome: "FAILURE" });
    });
  });

  it("no application role can insert, update, delete or truncate audit rows; the immutability trigger still holds", async () => {
    await withTx(async (c) => {
      await c.rpc("write_audit", null, "REPORT_SUBMITTED", "report", "1");
      for (const role of ["service_role", "authenticated", "anon"]) {
        for (const sql of ["update audit_logs set reason = 'x'", "delete from audit_logs", "truncate audit_logs",
          "insert into audit_logs (action, entity_type) values ('X', 'y')"]) {
          await c.client.query("savepoint s");
          await c.client.query(`set local role ${role}`);
          let denied = false;
          try { await c.client.query(sql); } catch (e) { denied = /permission denied/.test((e as Error).message); }
          await c.client.query("rollback to savepoint s");
          expect(denied, `${role}: ${sql}`).toBe(true);
        }
      }
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update audit_logs set reason = 'x'"));
    });
  });

  it("security_logs and system_logs are views over the same rows", async () => {
    await withTx(async (c) => {
      await c.q("select set_config('request.headers', $1, true)", [HEADERS]);
      await c.rpc("write_audit", null, "AUTH_LOGIN_FAILED", "user", "u", null, null, null, null, "DENIED");
      await c.q("select set_config('request.headers', '', true)");
      await c.rpc("write_audit", null, "JOB_FAILED", "job", "j", null, null, null, null, "FAILURE");
      expect((await c.q("select 1 from security_logs where action = 'AUTH_LOGIN_FAILED'")).length).toBe(1);
      expect((await c.q("select 1 from system_logs where action = 'JOB_FAILED'")).length).toBe(1);
      expect((await c.q("select 1 from system_logs where action = 'AUTH_LOGIN_FAILED'")).length).toBe(0);
    });
  });
});

describe("events nobody else records", () => {
  it("records unauthenticated/second-factor refusals, collapses repeats, and refuses unknown event names", async () => {
    await withTx(async (c) => {
      await c.q("select set_config('request.headers', $1, true)", [HEADERS]);
      expect(await c.rpc<boolean>("record_security_event", null, "SECURITY_AUTH_REQUIRED", "DENIED", "route", "/api/v1/users", { method: "GET" })).toBe(true);
      expect(await c.rpc<boolean>("record_security_event", null, "SECURITY_AUTH_REQUIRED", "DENIED", "route", "/api/v1/users", { method: "GET" })).toBe(false);
      expect(await c.rpc<boolean>("record_security_event", null, "SECURITY_AUTH_REQUIRED", "DENIED", "route", "/api/v1/other", null)).toBe(true);
      expect(await last(c)).toMatchObject({ event_category: "SECURITY", outcome: "DENIED", severity: "MEDIUM", ip_address: "203.0.113.9" });
      await c.expectError("VALIDATION_ERROR", () => c.rpc("record_security_event", null, "ANYTHING", "DENIED", "route", "/x", null));
    });
  });

  it("records looking at the log and exporting it, and only for people who may read it", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AC3");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      expect(await c.rpc<boolean>("record_audit_access", sa, "VIEWED", { q: "x" }, 10)).toBe(true);
      expect(await c.rpc<boolean>("record_audit_access", sa, "VIEWED", { q: "x" }, 10)).toBe(false);            // one per minute
      await c.rpc("record_audit_access", sa, "PDF", { q: "x" }, 10);
      expect(await last(c)).toMatchObject({ action: "AUDIT_EXPORTED", event_category: "FILES_EXPORT", actor_user_id: sa });
      await c.expectError("PERMISSION_DENIED", () => c.rpc("record_audit_access", lead, "VIEWED", null, 1));
    });
  });

  it("ending a person's sessions is recorded, and only when a session actually ended", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AC11");
      const u = await c.user(["BU_LEAD"], bu, "sessions");
      expect(await c.rpc<number>("revoke_user_sessions", u, null)).toBe(0);
      expect((await c.q("select 1 from audit_logs where action = 'AUTH_SESSIONS_REVOKED'")).length).toBe(0);
      await c.q("insert into auth.sessions (id, user_id, created_at) values (gen_random_uuid(), $1, now()), (gen_random_uuid(), $1, now())", [u]);
      expect(await c.rpc<number>("revoke_user_sessions", u, null)).toBe(2);
      expect(await last(c)).toMatchObject({ action: "AUTH_SESSIONS_REVOKED", entity_id: u, event_category: "SECURITY", new_values: { sessions_ended: 2, kept_one: false } });
    });
  });

  it("system lifecycle changes (no person) reach the audit log", async () => {
    await withTx(async (c) => {
      const a = await c.bu("AC4"); const b = await c.bu("AC5");
      const u = await c.user(["BU_LEAD"], a, "mover");
      await c.q("update employees set business_unit_id = $1 where id = (select employee_id from users where id = $2)", [b, u]);
      const rows = await c.q<Row>("select * from audit_logs where action = 'EMPLOYEE_LIFECYCLE_SYSTEM_CHANGE'");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toMatchObject({ event_category: "USER_LIFECYCLE", actor_user_id: null });
    });
  });
});

describe("detection rules and alerts", () => {
  it("raises one indicator for repeated failed sign-ins, does not repeat it, notifies reviewers, and words it as an indicator", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AC6");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      const target = await c.user(["BU_LEAD"], bu, "target");
      for (let i = 0; i < 5; i++) await c.rpc("write_audit", target, "AUTH_LOGIN_FAILED", "user", target, null, null, null, null, "DENIED");
      expect(await c.rpc<number>("audit_run_detection")).toBe(1);
      expect(await c.rpc<number>("audit_run_detection")).toBe(0);
      const alerts = await c.q<Row>("select * from audit_alerts");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ rule_code: "REPEATED_FAILED_LOGINS", severity: "HIGH", status: "NEW", event_count: 5 });
      expect(String(alerts[0].summary)).toContain("not a finding about anyone");
      expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'AUDIT_ALERT'", [sa])).length).toBe(1);
      expect((await c.q("select 1 from audit_logs where action = 'AUDIT_ALERT_RAISED'")).length).toBe(1);
    });
  });

  it("flags an administrator role grant and a person changing their own roles, but not an ordinary role change", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AC7");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      const other = await c.user(["PRESENTER"], bu, "other");
      await c.rpc("write_audit", sa, "USER_ROLES_CHANGED", "user", other, { roles: ["PRESENTER"] }, { roles: ["BU_LEAD"] });
      expect(await c.rpc<number>("audit_run_detection")).toBe(0);
      await c.rpc("write_audit", sa, "USER_ROLES_CHANGED", "user", other, { roles: ["PRESENTER"] }, { roles: ["ADMIN"] });
      await c.rpc("write_audit", other, "USER_ROLES_CHANGED", "user", other, { roles: ["PRESENTER"] }, { roles: ["BU_LEAD"] });
      expect(await c.rpc<number>("audit_run_detection")).toBe(2);
      expect((await c.q<{ rule_code: string }>("select rule_code from audit_alerts order by rule_code")).map((r) => r.rule_code)).toEqual(["PRIVILEGE_ESCALATION", "SELF_ROLE_CHANGE"]);
    });
  });

  it("honours a changed threshold and a disabled rule; configuring rules needs its own permission and a reason, and is audited", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AC8");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      const admin = await c.user(["ADMIN"], bu, "admin");
      for (let i = 0; i < 3; i++) await c.rpc("write_audit", sa, "REPORT_EXPORTED", "report", String(i));
      expect(await c.rpc<number>("audit_run_detection")).toBe(0);                       // threshold is 5
      await c.expectError("PERMISSION_DENIED", () => c.rpc("audit_rule_configure", admin, "UNUSUAL_EXPORTS", null, 3, null, null, "tighten"));
      await c.expectError("REASON_REQUIRED", () => c.rpc("audit_rule_configure", sa, "UNUSUAL_EXPORTS", null, 3, null, null, " "));
      await c.rpc("audit_rule_configure", sa, "UNUSUAL_EXPORTS", null, 3, null, null, "tighten");
      expect(await last(c)).toMatchObject({ action: "AUDIT_RULE_CHANGED", old_values: { threshold: 5 }, new_values: { threshold: 3 } });
      expect(await c.rpc<number>("audit_run_detection")).toBe(1);
      await c.rpc("audit_rule_configure", sa, "UNUSUAL_EXPORTS", false, null, null, null, "off for test");
      await c.rpc("write_audit", sa, "REPORT_EXPORTED", "report", "9");
      await c.rpc("write_audit", sa, "REPORT_EXPORTED", "report", "10");
      await c.rpc("write_audit", sa, "REPORT_EXPORTED", "report", "11");
      expect(await c.rpc<number>("audit_run_detection")).toBe(0);
    });
  });

  it("sets an investigation status with a reason, audits it, and lets only reviewers do it", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AC9");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      await c.rpc("write_audit", sa, "LOCK_SCHEDULE_CHANGED", "reporting_schedule", "1");
      await c.rpc("audit_run_detection");
      const id = (await c.q<{ id: string }>("select id from audit_alerts where rule_code = 'SCHEDULE_OR_LOCK_CHANGE'"))[0].id;
      await c.expectError("PERMISSION_DENIED", () => c.rpc("audit_alert_set_status", lead, id, "UNDER_REVIEW", null));
      await c.rpc("audit_alert_set_status", sa, id, "UNDER_REVIEW", null);
      await c.expectError("REASON_REQUIRED", () => c.rpc("audit_alert_set_status", sa, id, "EXPLAINED", ""));
      await c.rpc("audit_alert_set_status", sa, id, "EXPLAINED", "Planned change, ticket 42");
      expect(await c.q("select status, status_by from audit_alerts where id = $1", [id])).toEqual([{ status: "EXPLAINED", status_by: sa }]);
      expect(await last(c)).toMatchObject({ action: "AUDIT_ALERT_STATUS_CHANGED", old_values: { status: "UNDER_REVIEW" }, new_values: { status: "EXPLAINED", rule: "SCHEDULE_OR_LOCK_CHANGE" } });
    });
  });
});

describe("reads of the Centre", () => {
  it("counts for a period, traces an event to its workflow and request, and refuses people without audit.read", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AC10");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      await c.q("select set_config('request.headers', $1, true)", [HEADERS]);
      const wf = "99999999-0000-0000-0000-000000000001";
      await c.rpc("write_audit", sa, "CONFIG_CHANGE_REQUESTED", "config_change_request", wf);
      await c.rpc("write_audit", sa, "CONFIG_CHANGE_APPLIED", "config_change_request", wf);
      await c.rpc("write_audit", lead, "ACCESS_DENIED", "route", "/x", null, null, null, null, "DENIED");
      const k = await c.rpc<Record<string, unknown>>("audit_centre_kpis", sa, "2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z");
      expect(Number(k.total)).toBeGreaterThanOrEqual(3);
      expect(Number(k.denied)).toBeGreaterThanOrEqual(1);
      expect(k.by_category).toMatchObject({ CONFIGURATION: 2 });
      const id = (await c.q<{ id: string }>("select id from audit_logs where action = 'CONFIG_CHANGE_APPLIED' and workflow_id = $1", [wf]))[0].id;
      const t = await c.rpc<{ same_workflow: { action: string }[]; same_request: unknown[]; chain: { valid: boolean }; event: Row }>("audit_centre_trace", sa, id);
      expect(t.same_workflow.map((e) => e.action)).toEqual(["CONFIG_CHANGE_REQUESTED", "CONFIG_CHANGE_APPLIED"]);
      expect(t.same_request.length).toBeGreaterThanOrEqual(3);
      expect(t.chain.valid).toBe(true);
      expect(t.event.row_hash).toBeUndefined();
      await c.expectError("PERMISSION_DENIED", () => c.rpc("audit_centre_kpis", lead, "2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("audit_centre_trace", lead, id));
    });
  });
});
