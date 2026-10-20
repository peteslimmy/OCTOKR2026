import { describe, expect, it } from "vitest";
import { formatWeekLabel } from "../../src/lib/domain/week-label";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/**
 * Week 1 of the fixture quarter is Monday 6 Jan 2031; its content lock is Tuesday 7 Jan 18:00 Lagos time.
 * BUs: ALPHA submits, BRAVO does not, CHARLIE does not report weekly. Each has one Business Unit Lead.
 */
async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA"); const buB = await c.bu("BRAVO"); const buC = await c.bu("CHARLIE");
  await c.q("update business_units set reports_weekly = false where id = $1", [buC]);
  const admin = await c.user(["ADMIN"], buA, "admin"); const lead = await c.user(["BU_LEAD"], buA, "leadA");
  const leadA = lead, leadB = await c.user(["BU_LEAD"], buB, "leadB"); const leadC = await c.user(["BU_LEAD"], buC, "leadC");
  const hr = await c.user(["HR"], buA, "hr");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  return { buA, buB, buC, admin, leadA, leadB, leadC, hr, strat, wk };
}
type W = Awaited<ReturnType<typeof world>>;
const at = (hoursBeforeLock: number) => new Date(new Date(W1.contentLock).getTime() - hoursBeforeLock * 3_600_000).toISOString();
const reminders = async (c: Ctx, user: string) => c.q<{ title: string; message: string; dedupe_key: string }>("select title, message, dedupe_key from notifications where user_id = $1 and event_type = 'REPORT_DUE_REMINDER' order by created_at, dedupe_key", [user]);
const run = async (c: Ctx, hoursBeforeLock: number) => { await c.setNow(at(hoursBeforeLock)); return c.rpc<number>("send_report_reminders"); };
const submit = async (c: Ctx, w: W, lead: string) => {
  await c.setNow(W1.open);
  const g = await draftGoal(c, lead, w.wk, w.strat.subKrIds[0], ["t"], "Publish the pricing sheets by Friday");
  await c.rpc("submit_weekly_report", lead, g.reportId, null, null);
};

describe("week label in SQL matches the application's formatter", () => {
  it("writes every week of a quarter, and a year boundary, exactly as formatWeekLabel does", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("create_year_quarters", w.admin, 2030);
      await c.rpc("ensure_reporting_week", "2030-12-23"); await c.rpc("ensure_reporting_week", "2030-12-30");
      await c.rpc("ensure_reporting_week", "2031-03-31");
      const rows = await c.q<{ week_number: number; week_start_at: Date; label: string }>("select week_number, week_start_at, week_label_text(week_number, week_start_at) label from reporting_weeks order by week_start_at");
      expect(rows.length).toBeGreaterThan(14);
      for (const r of rows) expect(r.label, String(r.week_start_at)).toBe(formatWeekLabel({ week_number: r.week_number, week_start_at: r.week_start_at }));
      expect(rows.some((r) => /Dec 2030 – .* Jan 2031/.test(r.label))).toBe(true);     // a year-boundary week was covered
      expect(rows.some((r) => /^Week \d+, \d+–\d+ /.test(r.label))).toBe(true);        // and a within-one-month one
    });
  });
});

describe("report reminders", () => {
  it("send nothing outside the window, one per slot inside it, to the leads of units that have not submitted", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await submit(c, w, w.leadA);
      expect(await run(c, 30)).toBe(0);                                              // more than 24 hours before the lock
      expect(await run(c, 20)).toBe(1);                                              // the 24-hour slot: only BRAVO, whose report is missing
      expect((await reminders(c, w.leadB)).map((r) => r.title)).toEqual(["Weekly report due in about 20 hours"]);
      expect((await reminders(c, w.leadB))[0].message).toContain("BU BRAVO has not submitted its report for Week");
      expect(await reminders(c, w.leadA)).toHaveLength(0);                           // submitted
      expect(await reminders(c, w.leadC)).toHaveLength(0);                           // does not report weekly
      expect(await run(c, 19)).toBe(0);                                              // same slot again: nothing new
      expect(await run(c, 5)).toBe(1);                                               // the 6-hour slot
      expect((await reminders(c, w.leadB)).map((r) => r.title)).toEqual(["Weekly report due in about 20 hours", "Weekly report due in about 5 hours"]);
      expect(await run(c, 4)).toBe(0);
    });
  });

  it("name the week the way the application does", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await run(c, 20);
      const wk = (await c.q<{ week_number: number; week_start_at: Date }>("select week_number, week_start_at from reporting_weeks where id = $1", [w.wk]))[0];
      expect((await reminders(c, w.leadB))[0].message).toContain(formatWeekLabel({ week_number: wk.week_number, week_start_at: wk.week_start_at }));
    });
  });

  it("respect the frequency limit, per person and per week", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("update_notification_settings", w.admin, true, [24, 12, 6], 2, true);
      expect(await run(c, 23)).toBe(2);                                              // BRAVO and ALPHA are both missing
      expect(await run(c, 11)).toBe(2);
      expect(await run(c, 5)).toBe(0);                                               // a third slot, but two per person per week is the limit
      expect(await reminders(c, w.leadB)).toHaveLength(2);
      await c.rpc("update_notification_settings", w.admin, true, [24, 12, 6], 3, true);
      expect(await run(c, 5)).toBe(2);                                               // raising the limit lets the next slot through
    });
  });

  it("send only the latest slot when the scheduler was not running, not a burst", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await run(c, 5)).toBe(2);                                               // both slots passed unseen: one reminder each, for the 6-hour slot
      const mine = await reminders(c, w.leadB);
      expect(mine).toHaveLength(1);
      expect(mine[0].dedupe_key.endsWith(":6")).toBe(true);
    });
  });

  it("are suppressed for holiday weeks, after the lock, when disabled, for submitted units and for inactive people", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow(W1.open);
      await c.rpc("declare_organization_holiday", w.hr, [w.wk], "Office closure", "rem-hol-1");
      expect(await run(c, 5)).toBe(0);                                               // a holiday week is never reminded about
      await c.rpc("amend_organization_holiday", w.admin, w.wk, "REVERSE", "Cancelled", "rem-hol-2");   // before final lock: a plain single-Admin reversal
      await c.q("update users set status = 'SUSPENDED' where id = $1", [w.leadB]);
      expect(await run(c, 5)).toBe(1);                                               // only ALPHA's lead: BRAVO's lead is suspended
      expect(await reminders(c, w.leadB)).toHaveLength(0);
      await c.q("delete from notifications where event_type = 'REPORT_DUE_REMINDER'");
      await c.q("update users set status = 'ACTIVE' where id = $1", [w.leadB]);
      await c.rpc("update_notification_settings", w.admin, false, [24, 6], 2, true);
      expect(await run(c, 5)).toBe(0);                                               // switched off
      await c.rpc("update_notification_settings", w.admin, true, [24, 6], 2, true);
      await c.setNow(W1.afterContentLock);
      expect(await c.rpc<number>("send_report_reminders")).toBe(0);                  // the lock has passed: too late to remind
    });
  });

  it("are part of the scheduled job, which keeps going if they fail", async () => {
    await withTx(async (c) => {
      await world(c);
      await c.setNow(at(5));
      expect((await c.rpc<{ reminders_sent: number }>("run_scheduled_jobs")).reminders_sent).toBe(2);
      await c.q("create or replace function send_report_reminders() returns int language plpgsql as $$ begin raise exception 'BOOM'; end $$");
      const out = await c.rpc<{ reminders_sent: number }>("run_scheduled_jobs");
      expect(out.reminders_sent).toBe(0);                                            // the job completed
      expect((await c.q("select 1 from audit_logs where action = 'JOB_FAILED' and entity_id = 'send_report_reminders'")).length).toBe(1);
    });
  });
});

describe("settings", () => {
  it("need the permission, are validated, take effect in order and are audited", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("update_notification_settings", w.hr, true, [24], 2, true));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("update_notification_settings", w.leadA, true, [24], 2, true));
      for (const bad of [[], [0], [73], [24, 24], [1, 2, 3, 4, 5]]) await c.expectError("VALIDATION_ERROR", () => c.rpc("update_notification_settings", w.admin, true, bad, 2, true));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("update_notification_settings", w.admin, true, [24], 0, true));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("update_notification_settings", w.admin, true, [24], 6, true));
      const s = await c.rpc<{ reminder_hours: number[]; max_reminders_per_week: number }>("update_notification_settings", w.admin, true, [6, 48, 24], 3, false);
      expect(s.reminder_hours).toEqual([48, 24, 6]);
      expect(s.max_reminders_per_week).toBe(3);
      const a = (await c.q<{ old_values: { reminder_hours: number[] }; new_values: { email_enabled: boolean } }>("select old_values, new_values from audit_logs where action = 'NOTIFICATION_SETTINGS_UPDATED'"))[0];
      expect([a.old_values.reminder_hours, a.new_values.email_enabled]).toEqual([[24, 6], false]);
    });
  });
});

describe("email outbox", () => {
  const notify = (c: Ctx, user: string, event: string, key = `k-${event}-${Math.random()}`) =>
    c.q("select notify_users(array[$1::uuid], $2, 'user', $1::text, 'Title ' || $2, 'Message body', $3)", [user, event, key]);
  const outbox = (c: Ctx, user: string) => c.q<{ subject: string; mandatory: boolean; status: string; to_email: string }>("select subject, mandatory, status, to_email from email_outbox where user_id = $1 order by created_at", [user]);

  it("queues mail only for events that deserve it, with the person's own address, and respects their preference except for security events", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await notify(c, w.leadA, "REPORT_DUE_REMINDER");
      await notify(c, w.leadA, "SOME_ROUTINE_EVENT");                                // not an email event
      expect(await outbox(c, w.leadA)).toMatchObject([{ subject: "Title REPORT_DUE_REMINDER", mandatory: false, status: "PENDING" }]);
      expect((await outbox(c, w.leadA))[0].to_email).toMatch(/^leadA-.*@test\.local$/);
      await c.rpc("set_email_preference", w.leadA, false);
      await notify(c, w.leadA, "REPORT_DUE_REMINDER");
      await notify(c, w.leadA, "PASSWORD_CHANGED");
      await notify(c, w.leadA, "MFA_RECOVERED");
      const rows = await outbox(c, w.leadA);
      expect(rows.map((r) => r.subject)).toEqual(["Title REPORT_DUE_REMINDER", "Title PASSWORD_CHANGED", "Title MFA_RECOVERED"]);   // routine mail stopped, security mail did not
      expect(rows.slice(1).every((r) => r.mandatory)).toBe(true);
      expect((await c.q("select action from audit_logs where action = 'NOTIFICATION_PREFERENCE_CHANGED'")).length).toBe(1);
    });
  });

  it("queues nothing when email is switched off for the organisation or the person is not active, and never fails the notification", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("update notification_settings set email_enabled = false");
      await notify(c, w.leadA, "PASSWORD_CHANGED");
      expect(await outbox(c, w.leadA)).toHaveLength(0);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where user_id = $1", [w.leadA]))[0].n).toBe(1);       // the in-app notification is still there
      await c.q("update notification_settings set email_enabled = true");
      await c.q("update users set status = 'SUSPENDED' where id = $1", [w.leadB]);
      await notify(c, w.leadB, "PASSWORD_CHANGED");
      expect(await outbox(c, w.leadB)).toHaveLength(0);
      await c.q("alter table email_outbox add constraint boom check (subject = 'never')");           // make the mail insert itself fail
      await notify(c, w.leadA, "MFA_RESET");
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where user_id = $1 and event_type = 'MFA_RESET'", [w.leadA]))[0].n).toBe(1);   // a failing mail insert cannot take the notification with it
      expect(await outbox(c, w.leadA)).toHaveLength(0);
    });
  });

  it("hands out each mail once, backs off after a failure, gives up after five tries, and lets old mail expire", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await notify(c, w.leadA, "REPORT_DUE_REMINDER");
      const first = await c.rpc<{ id: string; attempts: number }[]>("claim_email_batch", 10);
      expect(first).toHaveLength(1);
      expect(first[0].attempts).toBe(1);
      expect(await c.rpc<unknown[]>("claim_email_batch", 10)).toHaveLength(0);          // leased: nobody else gets it
      await c.rpc("mark_email_result", first[0].id, false, "connection refused");
      expect((await c.q<{ status: string; attempts: number; last_error: string }>("select status, attempts, last_error from email_outbox"))[0]).toEqual({ status: "PENDING", attempts: 1, last_error: "connection refused" });
      expect(await c.rpc<unknown[]>("claim_email_batch", 10)).toHaveLength(0);          // backing off for minutes
      for (let i = 2; i <= 5; i++) {
        await c.q("update email_outbox set next_attempt_at = now() - interval '1 second'");
        const again = await c.rpc<{ id: string; attempts: number }[]>("claim_email_batch", 10);
        expect(again[0].attempts).toBe(i);
        await c.rpc("mark_email_result", again[0].id, false, `failure ${i}`);
      }
      expect((await c.q<{ status: string }>("select status from email_outbox"))[0].status).toBe("FAILED");   // five attempts, then it stops
      await c.q("update email_outbox set next_attempt_at = now() - interval '1 second'");
      expect(await c.rpc<unknown[]>("claim_email_batch", 10)).toHaveLength(0);

      await notify(c, w.leadA, "MFA_RESET");
      const [m] = await c.rpc<{ id: string }[]>("claim_email_batch", 10);
      await c.rpc("mark_email_result", m.id, true);
      expect((await c.q<{ status: string; sent_at: Date | null }>("select status, sent_at from email_outbox where id = $1", [m.id]))[0].status).toBe("SENT");
      await c.rpc("mark_email_result", m.id, false, "late failure");                     // a recorded result is final
      expect((await c.q<{ status: string }>("select status from email_outbox where id = $1", [m.id]))[0].status).toBe("SENT");

      await notify(c, w.leadB, "REPORT_DUE_REMINDER");
      await c.q("update email_outbox set expires_at = now() - interval '1 minute' where user_id = $1", [w.leadB]);
      expect(await c.rpc<unknown[]>("claim_email_batch", 10)).toHaveLength(0);
      expect((await c.q<{ status: string; last_error: string }>("select status, last_error from email_outbox where user_id = $1", [w.leadB]))[0]).toEqual({ status: "SKIPPED", last_error: "expired before it could be sent" });
    });
  });

  it("retakes mail that a crashed sender left leased, and parks mail that cannot be sent at all", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await notify(c, w.leadA, "REPORT_DUE_REMINDER"); await notify(c, w.leadB, "REPORT_DUE_REMINDER");
      expect(await c.rpc<unknown[]>("claim_email_batch", 10)).toHaveLength(2);
      await c.q("update email_outbox set leased_until = now() - interval '1 minute'");
      const [a, b] = await c.rpc<{ id: string; attempts: number }[]>("claim_email_batch", 10);
      expect([a.attempts, b.attempts]).toEqual([2, 2]);
      await c.rpc("skip_email", a.id, "no email provider is configured");
      expect((await c.q<{ status: string; last_error: string }>("select status, last_error from email_outbox where id = $1", [a.id]))[0]).toEqual({ status: "SKIPPED", last_error: "no email provider is configured" });
    });
  });

  it("is never readable by a browser session; only configurers see the summary, and it carries no message bodies", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await notify(c, w.leadA, "REPORT_DUE_REMINDER");
      await c.client.query("savepoint s");
      let denied = false;
      try { await c.asUser(w.leadA, () => c.q("select body from email_outbox")); } catch { denied = true; await c.client.query("rollback to savepoint s"); }
      expect(denied).toBe(true);
      await c.expectError("PERMISSION_DENIED", () => c.asUser(w.leadA, () => c.rpc("read_email_summary")));
      await c.expectError("PERMISSION_DENIED", () => c.asUser(w.hr, () => c.rpc("read_email_summary")));
      const [m] = await c.rpc<{ id: string }[]>("claim_email_batch", 10);
      await c.rpc("mark_email_result", m.id, false, "timeout");
      const s = await c.asUser(w.admin, () => c.rpc<{ counts: Record<string, number>; recent_problems: { error: string }[]; settings: { reminder_hours: number[] } }>("read_email_summary"));
      expect(s.counts).toEqual({ PENDING: 1 });
      expect(s.recent_problems[0].error).toBe("timeout");
      expect(s.settings.reminder_hours).toEqual([24, 6]);
      expect(JSON.stringify(s)).not.toContain("Message body");
      // a person can read their own preference and nobody else's
      await c.rpc("set_email_preference", w.leadB, false);
      expect(await c.asUser(w.leadA, async () => (await c.q("select * from notification_preferences")).length)).toBe(0);
      expect(await c.asUser(w.leadB, async () => (await c.q("select * from notification_preferences")).length)).toBe(1);
    });
  });
});
