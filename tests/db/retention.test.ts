import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("RT");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const hr = await c.user(["HR"], bu, "hr");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  return { bu, admin, sa, hr, lead };
}
const notify = async (c: Ctx, user: string, tag: string, ageDays: number, read: boolean) => (await c.q<{ id: string }>(
  "insert into notifications (user_id, event_type, title, message, dedupe_key, read_at, created_at) values ($1, 'RT_TEST', $2, 'x', $2, case when $3 then app_now() else null end, app_now() - make_interval(days => $4)) returning id", [user, tag, read, ageDays]))[0].id;
const mail = async (c: Ctx, user: string, notification: string, tag: string, ageDays: number, status: string) => (await c.q<{ id: string }>(
  `insert into email_outbox (notification_id, user_id, to_email, subject, body, status, created_at, expires_at)
   values ($1, $2, 'x@test.local', $3, 'b', $4, app_now() - make_interval(days => $5), app_now() - make_interval(days => $5) + interval '48 hours') returning id`, [notification, user, tag, status, ageDays]))[0].id;
const exists = async (c: Ctx, table: string, col: string, val: string) => (await c.q(`select 1 from ${table} where ${col} = $1`, [val])).length === 1;

describe("retention of transient data (ADR-072)", () => {
  it("removes only read notifications past their period and finished mail past its period", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const oldRead = await notify(c, w.lead, "old-read", 400, true);
      const newRead = await notify(c, w.lead, "new-read", 30, true);
      const oldUnread = await notify(c, w.lead, "old-unread", 400, false);
      const n1 = await notify(c, w.lead, "mail-old-sent", 5, false); await mail(c, w.lead, n1, "m-old-sent", 100, "SENT");
      const n2 = await notify(c, w.lead, "mail-new-sent", 5, false); await mail(c, w.lead, n2, "m-new-sent", 10, "SENT");
      const n3 = await notify(c, w.lead, "mail-old-failed", 5, false); await mail(c, w.lead, n3, "m-old-failed", 100, "FAILED");
      const n4 = await notify(c, w.lead, "mail-old-pending", 5, false); await mail(c, w.lead, n4, "m-old-pending", 100, "PENDING");   // expired long ago, so it is finished business too
      const n5 = await notify(c, w.lead, "mail-live-pending", 5, false);
      await c.q("insert into email_outbox (notification_id, user_id, to_email, subject, body, status) values ($1, $2, 'x@test.local', 'm-live-pending', 'b', 'PENDING')", [n5, w.lead]);

      const auditBefore = (await c.q<{ n: number }>("select count(*)::int n from audit_logs where action <> 'TRANSIENT_DATA_PURGED'"))[0].n;
      const out = await c.rpc<{ enabled: boolean; read_notifications: number; email_queue_rows: number }>("purge_transient_data");
      expect(out).toMatchObject({ enabled: true, read_notifications: 1, email_queue_rows: 3 });

      expect(await exists(c, "notifications", "id", oldRead)).toBe(false);
      expect(await exists(c, "notifications", "id", newRead)).toBe(true);
      expect(await exists(c, "notifications", "id", oldUnread)).toBe(true);                    // never read: someone may still need to act on it
      for (const [subject, gone] of [["m-old-sent", true], ["m-new-sent", false], ["m-old-failed", true], ["m-old-pending", true], ["m-live-pending", false]] as const) {
        expect((await c.q("select 1 from email_outbox where subject = $1", [subject])).length, subject).toBe(gone ? 0 : 1);
      }
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action <> 'TRANSIENT_DATA_PURGED'"))[0].n).toBe(auditBefore);       // the audit trail is untouched
      expect((await c.q("select 1 from audit_logs where action = 'TRANSIENT_DATA_PURGED'")).length).toBe(1);
    });
  });

  it("does nothing when switched off, and never touches the audit log or other records", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const old = await notify(c, w.lead, "old-read", 400, true);
      await c.q("update retention_settings set enabled = false");
      expect(await c.rpc<{ enabled: boolean }>("purge_transient_data")).toMatchObject({ enabled: false });
      expect(await exists(c, "notifications", "id", old)).toBe(true);
      await c.q("select write_audit(null, 'RT_TEST', 'test', 'x')");
      await c.client.query("savepoint s1");
      await expect(c.client.query("delete from audit_logs")).rejects.toThrow();            // append-only: even the purge's owner cannot remove audit entries
      await c.client.query("rollback to savepoint s1");
    });
  });

  it("runs at most once a day from the scheduler", async () => {
    await withTx(async (c) => {
      await c.q("delete from job_heartbeats where job = 'purge'");
      expect(await c.rpc("maybe_purge_transient_data")).not.toBeNull();
      expect(await c.rpc("maybe_purge_transient_data")).toBeNull();                        // too soon
      await c.q("update job_heartbeats set last_run_at = clock_timestamp() - interval '25 hours' where job = 'purge'");
      expect(await c.rpc("maybe_purge_transient_data")).not.toBeNull();
      await c.rpc("run_scheduled_jobs");                                                   // the scheduler calls it without failing, and records no failure
      expect((await c.q("select 1 from audit_logs where action = 'JOB_FAILED'")).length).toBe(0);
    });
  });

  it("the periods change only through an approved request, with plain validation", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const ask = (actor: string, p: unknown) => c.rpc<{ request_id: string }>("request_config_change", actor, "RETENTION", null, JSON.stringify(p), "Policy review", `rt-${Math.random()}-${Date.now()}`);
      await c.expectError("PERMISSION_DENIED", () => ask(w.hr, { enabled: true, readNotificationsMonths: 6, emailDays: 30 }));
      await c.expectError("VALIDATION_ERROR", () => ask(w.admin, { enabled: true, readNotificationsMonths: 2, emailDays: 30 }));
      await c.expectError("VALIDATION_ERROR", () => ask(w.admin, { enabled: true, readNotificationsMonths: 6, emailDays: 3 }));
      await c.expectError("VALIDATION_ERROR", () => ask(w.admin, { enabled: true, readNotificationsMonths: 12, emailDays: 90 }));   // already in force
      await c.expectError("VALIDATION_ERROR", () => ask(w.admin, { readNotificationsMonths: 6 }));
      const r = await ask(w.admin, { enabled: true, readNotificationsMonths: 6, emailDays: 30 });
      expect((await c.q<{ read_notifications_months: number }>("select read_notifications_months from retention_settings"))[0].read_notifications_months).toBe(12);
      expect((await c.q<{ current_value: { readNotificationsMonths: number } }>("select current_value from config_change_requests where id = $1", [r.request_id]))[0].current_value.readNotificationsMonths).toBe(12);
      await c.rpc("decide_config_change", w.sa, r.request_id, "APPROVE", null, `rt-d-${Date.now()}`);
      expect((await c.q<{ read_notifications_months: number; email_days: number }>("select read_notifications_months, email_days from retention_settings"))[0]).toEqual({ read_notifications_months: 6, email_days: 30 });
    });
  });

  it("the audit export is recorded, and only for people who may read the audit log", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("record_audit_export", w.hr, JSON.stringify({ action: "X" }), 10));
      await c.rpc("record_audit_export", w.admin, JSON.stringify({ action: "X" }), 10);
      const row = (await c.q<{ new_values: { rows: number; filter: { action: string } } }>("select new_values from audit_logs where action = 'AUDIT_EXPORTED'"))[0];
      expect(row.new_values).toMatchObject({ rows: 10, filter: { action: "X" } });
    });
  });
});
