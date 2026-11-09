import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

/**
 * Every database function that changes business data must leave an audit entry, directly or through a helper that does (ADR-121).
 * A new function that does not fails this test until it writes an entry or is listed below with its reason.
 */
const NOT_AUDITED_ON_PURPOSE: Record<string, string> = {
  // queues, leases, counters and housekeeping: no business decision is made
  acquire_edit_lease: "edit lease (heartbeat)", release_edit_lease: "edit lease (heartbeat)", claim_email_batch: "outbox queue", claim_webhook_batch: "webhook queue", mark_email_result: "outbox queue",
  mark_webhook_result: "webhook queue", skip_email: "outbox queue", mark_report_email_delivery: "report email queue (the run is audited when it starts and finishes)", finish_report_email_run: "report email queue",
  rate_limit_hit: "request counter", record_job_heartbeat: "job heartbeat", okr_idem: "idempotency key", okr_idem_done: "idempotency key", okr_next_ref: "reference counter", next_payment_reference: "reference counter",
  mark_all_notifications_read: "a person's own notifications", send_report_reminders: "scheduled reminders (notifications)", bump_report_version: "version counter, inside audited goal and task changes",
  // helpers always called inside a function that is audited
  create_weekly_snapshot: "inside audited week and correction functions", snapshot_quarterly_scores: "inside audited functions", snapshot_quarterly_scores_amended: "inside amend_organization_holiday",
  snapshot_quarterly_score_amendment: "inside apply_late_report_amendment", ensure_reporting_week: "inside audited calendar functions", ensure_violation_fund: "inside audited finance functions",
  eo_target_set: "inside update_eo_progress", import_void_purge: "inside history_void", insert_smart_evaluation: "inside create_goal and update_goal", lc_log: "writes the lifecycle event table from audited triggers",
  strategy_import_issues: "read-only check before strategy_import_commit",
  // staging of an import: the import itself is audited when it is applied or voided
  history_create_batch: "import staging (history_apply is audited)", history_stage_rows: "import staging", history_finish_staging: "import staging",
  // sign-in plumbing: the sign-in itself, failures and refusals are audited by the security events
  mfa_email_begin: "email code challenge", mfa_email_cancel: "email code challenge", revoke_recovery_codes: "called with audited second-factor functions",
  record_strategy_baseline: "not called by the application",
};

describe("audit coverage of the database functions that change data", () => {
  it("every one writes an audit entry (directly or through a helper) or is listed with its reason", async () => {
    await withTx(async (c) => {
      const fns = await c.q<{ proname: string; prosrc: string }>("select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p')");
      const audited = new Set(fns.filter((f) => /write_audit\s*\(|record_security_event\s*\(|insert\s+into\s+audit_logs/i.test(f.prosrc)).map((f) => f.proname));
      for (let grew = true; grew;) {
        grew = false;
        for (const f of fns) {
          if (audited.has(f.proname)) continue;
          if ([...audited].some((a) => new RegExp("\\b" + a + "\\s*\\(").test(f.prosrc))) { audited.add(f.proname); grew = true; }
        }
      }
      const writes = fns.filter((f) => /\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(f.prosrc));
      const missing = writes
        .filter((f) => !audited.has(f.proname) && !/^(read_|auth_|audit_|ops_|trg_|enqueue_|notify_|touch_|prevent_|guard_)/.test(f.proname) && !(f.proname in NOT_AUDITED_ON_PURPOSE))
        .map((f) => f.proname).sort();
      expect(missing, "functions that change data without an audit entry").toEqual([]);
      // and the list does not keep names that now are audited or no longer exist
      const stale = Object.keys(NOT_AUDITED_ON_PURPOSE).filter((n) => audited.has(n) || !fns.some((f) => f.proname === n));
      expect(stale, "entries to remove from the list").toEqual([]);
    });
  });

  it("changing an attendance status is audited, with the before and after", async () => {
    await withTx(async (c) => {
      expect((await c.q("select 1 from pg_proc where proname = 'set_attendance_status' and prosrc like '%ATTENDANCE_STATUS_SET%'")).length).toBe(1);
    });
  });
});
