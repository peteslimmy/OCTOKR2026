import "server-only";
import { DateTime } from "luxon";
import { isPlainRecipient } from "@/lib/email/deliver";
import { resolveEmail } from "@/lib/integrations/runtime";
import { adminClient } from "@/lib/supabase/admin";
import { BUSINESS_ZONE } from "@/lib/domain/time";
import { duePeriods, latestCompletedPeriod, periodFromKey, previousPeriod, trendWindow, type Frequency, type Period } from "./periods";
import { renderEmail, type Rendered, type Section } from "./render";
import { buildSummary, inRange, type QuarterRow, type Summary, type WeeklyRow } from "./summary";

/** Builds, sends and records automated report emails (ADR-115). The reads are organisation-wide aggregates (service role); every write goes through a database function that audits it. */
export interface ScheduleRow {
  id: string; name: string; frequency: Frequency; send_weekday: number; send_day: number; send_time: string;
  recipient_ids: string[]; sections: Section[]; is_active: boolean; created_by: string | null; created_at: string; updated_at: string;
}
export type Rpc = <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<T>;

/** An rpc for the scheduler, which has no signed-in person. */
export const jobRpc: Rpc = async (fn, args) => {
  const { data, error } = await adminClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as never;
};

async function rows<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await adminClient().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data as T[]) ?? [];
}

/** The figures for one period: this period, the one before it, and the window the trend is drawn from. */
export async function buildFor(period: Period): Promise<Summary> {
  const prev = previousPeriod(period);
  const win = trendWindow(period);
  const from = [win.from, prev.start].sort()[0];
  const weekly = await rows<WeeklyRow>("email_report_weekly_rows", { p_from: from, p_to: period.end });
  const quartersOf = async (p: Period): Promise<QuarterRow[][]> => {
    if (p.frequency === "QUARTERLY") return [await rows<QuarterRow>("email_report_quarter_rows", { p_year: p.year, p_quarter: p.quarter })];
    if (p.frequency === "ANNUAL") return Promise.all([1, 2, 3, 4].map((q) => rows<QuarterRow>("email_report_quarter_rows", { p_year: p.year, p_quarter: q })));
    return [];
  };
  const [quarters, previousQuarters] = await Promise.all([quartersOf(period), quartersOf(prev)]);
  return buildSummary({ period, weekly, previousWeekly: weekly.filter((r) => inRange(r, prev.start, prev.end)), quarters, previousQuarters });
}

export const loadSchedules = async (): Promise<ScheduleRow[]> => {
  const { data, error } = await adminClient().from("report_email_schedules").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ScheduleRow[]) ?? [];
};
export const loadSchedule = async (id: string): Promise<ScheduleRow | null> => {
  const { data, error } = await adminClient().from("report_email_schedules").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ScheduleRow | null) ?? null;
};

export interface Recipient { id: string; email: string }
/** Only active people with an account and a plain address: the list is re-checked at send time, not just when the schedule was saved. */
export async function activeRecipients(ids: string[]): Promise<Recipient[]> {
  if (!ids.length) return [];
  const { data, error } = await adminClient().from("users").select("id, email, status").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((u) => u.status === "ACTIVE" && isPlainRecipient(String(u.email))).map((u) => ({ id: u.id as string, email: String(u.email) }));
}

/** The period a person asked for, or the latest finished one. A period that has not ended yet is refused. */
export function resolvePeriod(frequency: Frequency, key: string | undefined, now = DateTime.now().setZone(BUSINESS_ZONE)): Period | "INVALID" | "NOT_ENDED" {
  if (!key) return latestCompletedPeriod(frequency, now);
  const p = periodFromKey(frequency, key);
  if (!p) return "INVALID";
  return p.end >= now.setZone(BUSINESS_ZONE).toFormat("yyyy-LL-dd") ? "NOT_ENDED" : p;           // the last day of the period must be before today
}

export async function renderFor(summary: Summary, schedule: Pick<ScheduleRow, "name" | "sections">, extra: { testNotice?: boolean } = {}): Promise<Rendered> {
  const mail = await resolveEmail().catch(() => null);
  return renderEmail(summary, { sections: schedule.sections, scheduleName: schedule.name, appUrl: mail?.appUrl ?? process.env.APP_BASE_URL, testNotice: extra.testNotice });
}

/** Sends one rendered email to one address. */
export async function sendOne(to: string, r: Rendered): Promise<"SENT" | { error: string }> {
  const { transport } = await resolveEmail();
  if (!transport) return { error: "no email provider is configured" };
  if (!isPlainRecipient(to)) return { error: "the recipient address is not a single plain address" };
  try { await transport.send({ to, subject: r.subject, text: r.text, html: r.html }); return "SENT"; }
  catch (e) { return { error: e instanceof Error ? e.message : "send failed" }; }
}

/** Sends every queued delivery of a run (first send and retry alike), records each result and settles the run's status. */
export async function dispatchRun(runId: string, rpc: Rpc = jobRpc): Promise<{ status: string; sent: number; failed: number }> {
  const sb = adminClient();
  const { data: run, error } = await sb.from("report_email_runs").select("id, schedule_id, summary, subject").eq("id", runId).single();
  if (error || !run) throw new Error(error?.message ?? "run not found");
  const schedule = await loadSchedule(run.schedule_id as string);
  const { data: queued } = await sb.from("report_email_deliveries").select("id, email").eq("run_id", runId).eq("status", "QUEUED");
  let sent = 0, failed = 0;
  if (queued?.length) {
    const rendered = renderEmail(run.summary as Summary, { sections: schedule?.sections ?? [], scheduleName: schedule?.name ?? "Report summary", appUrl: (await resolveEmail().catch(() => null))?.appUrl ?? process.env.APP_BASE_URL });
    for (const d of queued) {
      const res = await sendOne(String(d.email), rendered);
      await rpc("mark_report_email_delivery", { p_id: d.id, p_ok: res === "SENT", p_error: res === "SENT" ? null : res.error });
      if (res === "SENT") sent++; else failed++;
    }
  }
  const status = await rpc<string>("finish_report_email_run", { p_run: runId });
  return { status, sent, failed };
}

/** Starts a run for a period (the unique rule refuses a second one) and sends it. Returns null when it was already sent. */
export async function startAndSend(args: { schedule: ScheduleRow; period: Period; trigger: "SCHEDULED" | "MANUAL"; actor: string | null; rpc: Rpc }) {
  const { schedule, period, trigger, actor, rpc } = args;
  const summary = await buildFor(period);
  const recipients = await activeRecipients(schedule.recipient_ids);
  const rendered = await renderFor(summary, schedule);
  const runId = await rpc<string>("begin_report_email_run", {
    p_actor: actor, p_schedule: schedule.id, p_trigger: trigger, p_period_key: period.key, p_start: period.start, p_end: period.end,
    p_summary: summary, p_subject: rendered.subject, p_recipients: recipients,
  });
  return { runId, ...(await dispatchRun(runId, rpc)), recipients: recipients.length };
}

/** The scheduler step: sends what is due, and finishes anything a crash left half-sent. Never throws for one schedule's problem. */
export async function runDueEmailReports(now: DateTime = DateTime.now().setZone(BUSINESS_ZONE)) {
  const out = { schedules: 0, started: 0, skipped: 0, resumed: 0, errors: 0 };
  const sb = adminClient();
  const { data: stuck } = await sb.from("report_email_runs").select("id").eq("status", "PENDING").lt("created_at", now.minus({ minutes: 10 }).toUTC().toISO()!);
  for (const r of stuck ?? []) { try { await dispatchRun(r.id as string); out.resumed++; } catch (e) { out.errors++; console.error("report email resume failed", e instanceof Error ? e.message : e); } }
  for (const s of (await loadSchedules()).filter((x) => x.is_active)) {
    out.schedules++;
    try {
      for (const p of duePeriods(s, now, DateTime.fromISO(s.created_at))) {
        try { await startAndSend({ schedule: s, period: p, trigger: "SCHEDULED", actor: null, rpc: jobRpc }); out.started++; }
        catch (e) { if (e instanceof Error && e.message.startsWith("REPORT_EMAIL_ALREADY_SENT")) out.skipped++; else throw e; }
      }
    } catch (e) { out.errors++; console.error("report email schedule failed", s.id, e instanceof Error ? e.message : e); }
  }
  return out;
}

export interface Person { id: string; name: string; email: string }
/** Everyone who could be chosen as a recipient: active people with an account. */
export async function listPeople(): Promise<Person[]> {
  const { data, error } = await adminClient().from("users").select("id, email, status, employees(first_name, last_name)").eq("status", "ACTIVE").order("email");
  if (error) throw new Error(error.message);
  type Row = { id: string; email: string; employees: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null };
  return ((data ?? []) as unknown as Row[]).map((u) => {
    const emp = Array.isArray(u.employees) ? u.employees[0] : u.employees;
    return { id: u.id, email: String(u.email), name: emp ? `${emp.first_name} ${emp.last_name}`.trim() : String(u.email) };
  });
}
