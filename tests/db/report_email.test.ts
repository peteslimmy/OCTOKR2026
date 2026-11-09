import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("EMAILBU");
  const root = await c.user(["SUPER_ADMIN"], bu, "root"); const admin = await c.user(["ADMIN"], bu, "admin"); const lead = await c.user(["BU_LEAD"], bu, "lead");
  const r1 = await c.user(["EXECUTIVE"], bu, "r1"); const r2 = await c.user(["DIRECTOR"], bu, "r2");
  return { bu, root, admin, lead, r1, r2 };
}
const save = (c: Ctx, actor: string, id: string | null, recipients: string[], over: { name?: string; frequency?: string; sections?: string[] } = {}) =>
  c.rpc<string>("save_report_email_schedule", actor, id, over.name ?? "Leadership weekly", over.frequency ?? "WEEKLY", 1, 1, "08:00", recipients, over.sections ?? ["HEADLINES", "RANKING"], true);
const begin = async (c: Ctx, actor: string | null, schedule: string, trigger: string, key: string, recipients: { id: string; email: string }[]) =>
  (await c.q<{ r: string }>("select begin_report_email_run($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb) as r",
    [actor, schedule, trigger, key, "2026-10-26", "2026-11-01", JSON.stringify({ version: 1 }), "Subject", JSON.stringify(recipients)]))[0].r;
const deliveries = (c: Ctx, run: string) => c.q<{ id: string; email: string; status: string; attempts: number }>("select id, email, status, attempts from report_email_deliveries where run_id = $1 order by email", [run]);
const runStatus = async (c: Ctx, run: string) => (await c.q<{ status: string }>("select status from report_email_runs where id = $1", [run]))[0].status;
const people = async (c: Ctx, ids: string[]) => c.q<{ id: string; email: string }>("select id, email::text as email from users where id = any($1) order by email", [ids]);

describe("automated report emails (ADR-115)", () => {
  it("only Admin and Super Admin hold the three permissions", async () => {
    await withTx(async (c) => {
      for (const code of ["report_email.manage", "report_email.send", "report_email.history"]) {
        const who = (await c.q<{ code: string }>("select r.code from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id where p.code = $1 order by 1", [code])).map((x) => x.code);
        expect(who).toEqual(["ADMIN", "SUPER_ADMIN"]);
      }
    });
  });

  it("a schedule is created and changed by someone with the permission, with an audit record each time", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => save(c, w.lead, null, [w.r1]));
      const id = await save(c, w.admin, null, [w.r1, w.r2]);
      await save(c, w.admin, id, [w.r1], { name: "Renamed", sections: ["HEADLINES"] });
      const row = (await c.q<{ name: string; recipient_ids: string[]; sections: string[] }>("select name, recipient_ids, sections from report_email_schedules where id = $1", [id]))[0];
      expect(row).toEqual({ name: "Renamed", recipient_ids: [w.r1], sections: ["HEADLINES"] });
      const audit = await c.q<{ action: string }>("select action from audit_logs where entity_id = $1 and action like 'REPORT_EMAIL_%' order by occurred_at, id", [id]);
      expect(audit.map((a) => a.action)).toEqual(["REPORT_EMAIL_SCHEDULE_CREATED", "REPORT_EMAIL_SCHEDULE_CHANGED"]);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("delete_report_email_schedule", w.lead, id));
      await c.rpc("delete_report_email_schedule", w.root, id);
      expect(await c.q("select 1 from report_email_schedules where id = $1", [id])).toHaveLength(0);
    });
  });

  it("refuses no recipients, a suspended recipient and an unknown frequency", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => save(c, w.admin, null, []));
      await c.q("update users set status = 'SUSPENDED' where id = $1", [w.r2]);
      await c.expectError("VALIDATION_ERROR", () => save(c, w.admin, null, [w.r1, w.r2]));
      await c.expectError("VALIDATION_ERROR", () => save(c, w.admin, null, [w.r1], { frequency: "DAILY" }));
    });
  });

  it("a period is emailed once per schedule: a second start for the same period is refused, whoever starts it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const s = await save(c, w.admin, null, [w.r1]);
      const run = await begin(c, null, s, "SCHEDULED", "2026-W44", await people(c, [w.r1]));
      expect((await deliveries(c, run)).map((d) => d.status)).toEqual(["QUEUED"]);
      const again = await people(c, [w.r1]);
      await c.expectError("REPORT_EMAIL_ALREADY_SENT", () => begin(c, null, s, "SCHEDULED", "2026-W44", again));
      await c.expectError("REPORT_EMAIL_ALREADY_SENT", () => begin(c, w.admin, s, "MANUAL", "2026-W44", []));
      const other = await save(c, w.admin, null, [w.r1], { name: "Another schedule" });
      await begin(c, null, other, "SCHEDULED", "2026-W44", await people(c, [w.r1]));            // a different schedule may send the same period
      await begin(c, null, s, "SCHEDULED", "2026-W45", await people(c, [w.r1]));                // and the same schedule the next period
    });
  });

  it("a manual send needs the send permission and is audited", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const s = await save(c, w.admin, null, [w.r1]);
      await c.expectError("PERMISSION_DENIED", () => begin(c, w.lead, s, "MANUAL", "2026-W44", []));
      const run = await begin(c, w.admin, s, "MANUAL", "2026-W44", await people(c, [w.r1]));
      expect((await c.q("select 1 from audit_logs where entity_id = $1 and action = 'REPORT_EMAIL_SENT_MANUALLY' and actor_user_id = $2", [run, w.admin])).length).toBe(1);
    });
  });

  it("a run is Sent, Partly sent or Failed from its deliveries, and a run with nobody to send to is Empty", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const s = await save(c, w.admin, null, [w.r1, w.r2]);
      const run = await begin(c, null, s, "SCHEDULED", "2026-W44", await people(c, [w.r1, w.r2]));
      const [a, b] = await deliveries(c, run);
      await c.rpc("mark_report_email_delivery", a.id, true, null);
      await c.rpc("mark_report_email_delivery", b.id, false, "mailbox full");
      expect(await c.rpc("finish_report_email_run", run)).toBe("PARTIAL");
      await c.rpc("mark_report_email_delivery", a.id, false, "provider down");
      expect(await c.rpc("finish_report_email_run", run)).toBe("FAILED");
      const none = await begin(c, null, s, "SCHEDULED", "2026-W45", []);
      expect(await runStatus(c, none)).toBe("EMPTY");
    });
  });

  it("retry re-queues only the failed deliveries; people who already received it are untouched; sending the rest completes the run", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const s = await save(c, w.admin, null, [w.r1, w.r2]);
      const run = await begin(c, null, s, "SCHEDULED", "2026-W44", await people(c, [w.r1, w.r2]));
      const [a, b] = await deliveries(c, run);
      await c.rpc("mark_report_email_delivery", a.id, true, null);
      await c.rpc("mark_report_email_delivery", b.id, false, "timeout");
      await c.rpc("finish_report_email_run", run);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("retry_report_email_run", w.lead, run));
      expect(await c.rpc("retry_report_email_run", w.admin, run)).toBe(1);
      expect((await deliveries(c, run)).map((d) => [d.email === a.email, d.status])).toEqual(expect.arrayContaining([[true, "SENT"], [false, "QUEUED"]]));
      expect(await runStatus(c, run)).toBe("PENDING");
      await c.rpc("mark_report_email_delivery", b.id, true, null);
      expect(await c.rpc("finish_report_email_run", run)).toBe("SENT");
      expect((await deliveries(c, run)).find((d) => d.id === a.id)!.attempts).toBe(1);        // the first person was not mailed again
      expect(await c.rpc("retry_report_email_run", w.admin, run)).toBe(0);                    // nothing left to retry
    });
  });

  it("the aggregate readers and the tables are closed to signed-in users; only the server can use them", async () => {
    await withTx(async (c) => {
      for (const fn of ["email_report_weekly_rows(date,date)", "email_report_quarter_rows(integer,integer)", "begin_report_email_run(uuid,uuid,text,text,date,date,jsonb,text,jsonb)", "mark_report_email_delivery(uuid,boolean,text)", "finish_report_email_run(uuid)"]) {
        const [r] = await c.q<{ a: boolean; s: boolean }>("select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('service_role', $1, 'execute') s", [fn]);
        expect(r, fn).toEqual({ a: false, s: true });
      }
      for (const t of ["report_email_schedules", "report_email_runs", "report_email_deliveries"]) {
        const [r] = await c.q<{ s: boolean; i: boolean }>("select has_table_privilege('authenticated', $1, 'select') s, has_table_privilege('anon', $1, 'select') i", [t]);
        expect(r, t).toEqual({ s: false, i: false });
      }
    });
  });

  it("the aggregate readers return business-unit rows only, with no person in them", async () => {
    await withTx(async (c) => {
      await world(c);
      const rows = await c.rpc<Record<string, unknown>[]>("email_report_weekly_rows", "2020-01-01", "2040-01-01");
      expect(Array.isArray(rows)).toBe(true);
      for (const r of rows) expect(Object.keys(r).sort()).toEqual(["bu_code", "business_unit", "business_unit_id", "compliance_status", "final_score", "reporting_state", "result_state", "submitted_before_content_lock", "week_number", "week_start_at", "week_status", "week_year"].sort());
    });
  });
});
