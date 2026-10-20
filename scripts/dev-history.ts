/**
 * LOCAL DEVELOPMENT ONLY. Plays several reporting weeks through the REAL workflow (draft, submit, content lock, execute, final lock,
 * scoring, review) using the development clock, so the Reports module has history to analyse. Nothing is inserted into score tables
 * directly: every number comes from the production scoring functions. Refuses to run against a non-local database.
 *
 *   npm run dev:seed && npm run dev:history -- 6      then:  npm run dev:clock -- off
 *
 * The data is deliberately uneven (one improving BU, one declining BU with a missed week, BUs without a lead never report) so
 * trends, anomalies, compliance and projections have something to show. It is demo data and is never present in a real environment.
 */
import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { evaluateSmart } from "../src/lib/domain/smart";

config({ path: ".env.local" });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(URL_)) { console.error("dev-history refuses to run against a non-local Supabase URL:", URL_); process.exit(1); }
const sb = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const weeksToPlay = Math.max(1, Math.min(12, Number(process.argv[2] ?? 6)));

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => must(await sb.rpc(fn, args), fn) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Freezes the database clock, then waits until the REST layer (recycled by dev-clock) answers again. */
async function clock(iso: string) {
  execFileSync("npm", ["run", "dev:clock", "--", iso], { stdio: "pipe", shell: true });
  for (let i = 0; i < 60; i++) {
    const { error } = await sb.rpc("read_server_time");
    if (!error) return;
    await sleep(1000);
  }
  throw new Error("the REST layer did not come back after the clock change");
}
const at = (d: string, min: number) => new Date(new Date(d).getTime() + min * 60_000).toISOString();

const GOAL_TITLES = [
  "Publish the revised pricing sheets to every sales lead by Friday 17:00", "Close 3 open customer proposals with signed quotes before Thursday",
  "Resolve all P1 support tickets older than 5 days by Wednesday", "Complete onboarding for 2 new hires and record sign-off by Friday",
];

async function main() {
  const user = async (email: string) => must(await sb.from("users").select("id, employees(business_unit_id)").eq("email", email).single(), email) as unknown as { id: string; employees: { business_unit_id: string } };
  const leads = [{ email: "lead.eng@4core.local", plan: (i: number) => ({ goals: 3, doneFraction: Math.min(0.9, 0.35 + 0.12 * i), submit: true }) },
                 { email: "lead.sales@4core.local", plan: (i: number) => ({ goals: 3, doneFraction: Math.max(0.1, 0.9 - 0.14 * i), submit: i !== 3 }) }];
  const presenter = (await user("presenter@4core.local")).id;
  const quarter = must(await sb.from("quarters").select("id").eq("status", "ACTIVE").single(), "active quarter") as { id: string };
  const weeks = must(await sb.from("reporting_weeks").select("*").eq("quarter_id", quarter.id).order("week_start_at").limit(weeksToPlay), "weeks") as
    { id: string; week_start_at: string; content_lock_at: string; final_lock_at: string }[];
  const subKrs = must(await sb.from("sub_key_results").select("id, title, key_results!inner(objective_id, quarterly_objectives!inner(quarter_id))").eq("key_results.quarterly_objectives.quarter_id", quarter.id), "sub-krs") as unknown as { id: string; title: string }[];
  const reviewLater: { reportId: string; weekIdx: number }[] = [];

  for (const [i, w] of weeks.entries()) {
    console.log(`week ${i + 1}/${weeks.length}`);
    await clock(at(w.week_start_at, 10 * 60));
    const reports: { lead: string; reportId: string; fraction: number }[] = [];
    for (const l of leads) {
      const p = l.plan(i);
      if (!p.submit) continue;
      const u = await user(l.email);
      const reportId = await rpc<string>("get_or_create_weekly_report", { p_actor: u.id, p_week_id: w.id });
      await rpc("acquire_edit_lease", { p_actor: u.id, p_report_id: reportId, p_ttl_seconds: 600 });
      for (let g = 0; g < p.goals; g++) {
        const sub = subKrs[(g + i) % subKrs.length];
        const stretch = g === p.goals - 1;
        const title = GOAL_TITLES[(g + i) % GOAL_TITLES.length];
        const tasks = [{ description: "Draft the deliverable" }, { description: "Review it with the owner" }];
        const version = (must(await sb.from("weekly_reports").select("version").eq("id", reportId).single(), "version") as { version: number }).version;
        const evaluation = evaluateSmart({ title, description: null, taskDescriptions: tasks.map((t) => t.description), subKrTitle: stretch ? null : sub.title, goalType: stretch ? "STRETCH" : "KR_ALIGNED" });
        await rpc("create_goal", { p_actor: u.id, p_report_id: reportId, p_goal_type: stretch ? "STRETCH" : "KR_ALIGNED", p_sub_kr_id: stretch ? null : sub.id,
          p_title: title, p_description: null, p_tasks: tasks, p_evaluation: evaluation, p_expected_version: version });
      }
      await rpc("submit_weekly_report", { p_actor: u.id, p_report_id: reportId, p_summary_comment: null, p_expected_version: null });
      await rpc("release_edit_lease", { p_actor: u.id, p_report_id: reportId });
      reports.push({ lead: u.id, reportId, fraction: p.doneFraction });
      reviewLater.push({ reportId, weekIdx: i });
    }
    await clock(at(w.content_lock_at, 1));
    for (const r of reports) {
      const goals = must(await sb.from("smart_goals").select("id").eq("weekly_report_id", r.reportId).is("deleted_at", null).order("position"), "goals") as { id: string }[];
      const doneGoals = Math.round(goals.length * r.fraction);
      for (const [gi, g] of goals.entries()) {
        const tasks = must(await sb.from("tasks").select("id").eq("smart_goal_id", g.id).is("deleted_at", null).order("position"), "tasks") as { id: string }[];
        for (const [ti, t] of tasks.entries()) await rpc("execute_task", { p_actor: r.lead, p_task_id: t.id, p_status: gi < doneGoals ? "DONE" : ti === 0 ? "NOT_DONE" : "DONE" });
      }
    }
    await clock(at(w.final_lock_at, 1));
    await rpc("run_scheduled_jobs", {});
  }
  // review everything except the two most recent weeks, so the backlog is visible but not total
  for (const r of reviewLater.filter((x) => x.weekIdx < weeks.length - 2)) await rpc("review_weekly_report", { p_actor: presenter, p_report_id: r.reportId });
  console.log(`Played ${weeks.length} weeks. The development clock is frozen after the last final lock; release it with: npm run dev:clock -- off`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
