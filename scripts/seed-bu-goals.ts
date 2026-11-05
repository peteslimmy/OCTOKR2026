/**
 * LOCAL DEVELOPMENT ONLY. Seeds demo data for the Business Unit goals feature on the real local database, through the real functions:
 *   - three Business Unit goals for the active quarter for every unit that files weekly reports
 *   - weekly reports for the first weeks of that quarter, each with goals aligned to a Sub-KR AND a unit goal, tasks decided Done / Not done,
 *     a formatted comment and (for the past weeks) a submission, so the week-by-week chart has something to draw
 *
 *   npm run seed:bugoals -- add --yes        takes a backup first, then seeds (safe to run again: it skips what already exists)
 *   npm run seed:bugoals -- remove --yes     takes a backup first, then deletes exactly what this script created (read from the manifest)
 *
 * The seeded weeks have their content and final locks SUSPENDED so reports can be created by hand; `remove` restores the locks it suspended.
 * Every number is demo data. It is never run against anything except the local Supabase.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { evaluateSmart } from "../src/lib/domain/smart";
import { backupRealDatabase } from "./db-backup.mjs";

config({ path: ".env.local" });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(URL_)) { console.error("Refusing to run against a non-local Supabase URL:", URL_); process.exit(1); }
const [mode, flag] = [process.argv[2], process.argv[3]];
if (!["add", "remove"].includes(mode) || flag !== "--yes") { console.error("Usage: npm run seed:bugoals -- add|remove --yes"); process.exit(1); }

const sb = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const MANIFEST = ".local/seed-bu-goals-manifest.json";
const CONTAINER = "supabase_db_4core-okr";
const WEEKS_TO_SEED = 4;

interface Manifest { createdAt: string; backup: string; buGoalIds: string[]; reportIds: string[]; suspendedWeekIds: string[] }
const must = <T,>(r: { data: T; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => must(await sb.rpc(fn, args), fn) as T;
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };   // stable 0..1 from text
const readManifest = (): Manifest | null => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null);
const writeManifest = (m: Manifest) => { mkdirSync(".local", { recursive: true }); writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); };
const psql = (sql: string) => { const r = spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr || r.stdout); return r.stdout; };

async function superAdmin() {
  const rows = must(await sb.from("users").select("id, email, user_roles!user_roles_user_id_fkey!inner(roles!inner(code))").eq("user_roles.roles.code", "SUPER_ADMIN").limit(1), "super admin") as unknown as { id: string; email: string }[];
  if (!rows[0]) throw new Error("no Super Admin account found");
  return rows[0];
}

async function add() {
  const backup = backupRealDatabase();
  console.log("Backup:", backup);
  const admin = await superAdmin();
  const manifest: Manifest = readManifest() ?? { createdAt: new Date().toISOString(), backup, buGoalIds: [], reportIds: [], suspendedWeekIds: [] };

  const quarter = must(await sb.from("quarters").select("id, quarter_number, year").eq("status", "ACTIVE").single(), "active quarter") as { id: string; quarter_number: number; year: number };
  const weeks = (must(await sb.from("reporting_weeks").select("id, week_number, week_start_at, status, reporting_state, locks_suspended_at").eq("quarter_id", quarter.id).order("week_start_at").limit(WEEKS_TO_SEED), "weeks") as
    { id: string; week_number: number; week_start_at: string; status: string; reporting_state: string; locks_suspended_at: string | null }[]).filter((w) => w.status !== "FINAL_LOCKED" && w.reporting_state === "NORMAL");
  const units = must(await sb.from("business_units").select("id, code, name").eq("status", "ACTIVE").eq("reports_weekly", true).order("code"), "units") as { id: string; code: string; name: string }[];
  const subKrs = must(await sb.from("sub_key_results").select("id, title, status, key_results!inner(code, objective_id, quarterly_objectives!inner(quarter_id))").eq("key_results.quarterly_objectives.quarter_id", quarter.id).eq("status", "ACTIVE").order("code"), "sub-KRs") as unknown as { id: string; title: string }[];
  if (!weeks.length || !units.length || !subKrs.length) throw new Error("the active quarter needs weeks, reporting units and Sub-KRs first");

  // the weeks stay open for hand-filled reports until the locks are restored
  for (const w of weeks) if (!w.locks_suspended_at) { await rpc("set_week_locks_suspended", { p_actor: admin.id, p_week_id: w.id, p_suspend: true, p_reason: "Seed: demo weeks for Business Unit goals" }); manifest.suspendedWeekIds.push(w.id); }

  const now = Date.now();
  for (const u of units) {
    // --- the unit's own goals
    const wanted = [`Grow ${u.name} delivery and revenue by 15% this quarter`, `Close every ${u.name} milestone on schedule with no overdue items`, `Strengthen ${u.name} partner relationships and team capability`];
    let existing = must(await sb.from("bu_goals").select("id, title").eq("business_unit_id", u.id).eq("quarter_id", quarter.id), "BU goals") as { id: string; title: string }[];
    for (const title of wanted) if (!existing.some((g) => g.title === title)) manifest.buGoalIds.push(await rpc<string>("save_bu_goal", { p_actor: admin.id, p_id: null, p_bu: u.id, p_quarter: quarter.id, p_title: title, p_status: "ACTIVE" }));
    existing = must(await sb.from("bu_goals").select("id, title").eq("business_unit_id", u.id).eq("quarter_id", quarter.id).eq("status", "ACTIVE").order("position"), "BU goals") as { id: string; title: string }[];

    // --- weekly reports: a unit-specific level and drift, so the lines differ from unit to unit
    const base = 0.3 + 0.5 * hash(u.code), drift = (hash(`${u.code}-drift`) - 0.4) * 0.14;
    for (const [wi, w] of weeks.entries()) {
      // only a report this script creates goes in the manifest: one that already existed (somebody's own work) is never removed by `remove`
      const before = must(await sb.from("weekly_reports").select("id").eq("business_unit_id", u.id).eq("reporting_week_id", w.id).limit(1), "existing report") as { id: string }[];
      const reportId = await rpc<string>("get_or_create_weekly_report", { p_actor: admin.id, p_week_id: w.id, p_bu: u.id });
      if (!before.length && !manifest.reportIds.includes(reportId)) manifest.reportIds.push(reportId);
      const has = must(await sb.from("smart_goals").select("id").eq("weekly_report_id", reportId).is("deleted_at", null).limit(1), "goals") as { id: string }[];
      if (has.length) continue;                                                       // already seeded: leave it alone
      const current = new Date(w.week_start_at).getTime() <= now && wi === weeks.length - 1 && new Date(w.week_start_at).getTime() + 7 * 864e5 > now;
      await rpc("acquire_edit_lease", { p_actor: admin.id, p_report_id: reportId, p_ttl_seconds: 600 });
      const level = Math.max(0.05, Math.min(0.95, base + drift * wi + (hash(`${u.code}${wi}`) - 0.5) * 0.25));
      const taskIds: { id: string; fullyDone: boolean; partial: boolean }[][] = [];
      for (let gi = 0; gi < 3; gi++) {
        const sub = subKrs[(gi + wi + Math.floor(hash(u.code) * 5)) % subKrs.length];
        const topic = sub.title.split("(")[0].trim().toLowerCase();
        const n = 3 + Math.floor(hash(`${u.code}${wi}${gi}`) * 5);
        const title = [`Complete ${n} ${topic} follow-ups with ${u.name} partners by Friday 17:00`, `Publish the ${u.name} ${topic} status report to leadership by Thursday 12:00`, `Resolve ${n} open ${topic} issues raised by partners before Wednesday`][gi];
        const tasks = [`Schedule the ${n} follow-ups by Monday`, `Hold the sessions and log each outcome in the tracker`, `Send the summary to leadership by Thursday`];
        const ev = evaluateSmart({ title, subKrTitle: sub.title, goalType: "KR_ALIGNED" });
        const made = await rpc<{ goal_id: string }>("create_goal", { p_actor: admin.id, p_report_id: reportId, p_goal_type: "KR_ALIGNED", p_sub_kr_id: sub.id, p_title: title, p_description: null,
          p_tasks: tasks.map((description) => ({ description })), p_evaluation: ev, p_expected_version: null, p_bu_goal_id: existing[gi % existing.length].id });
        const rows = must(await sb.from("tasks").select("id").eq("smart_goal_id", made.goal_id).order("position"), "tasks") as { id: string }[];
        const full = hash(`${u.code}${wi}${gi}full`) < level;                       // a goal is done only when every task is
        taskIds.push(rows.map((r, ti) => ({ id: r.id, fullyDone: full, partial: !full && ti < rows.length - 1 })));
      }
      // decide the tasks (the current week is left partly open, like a week in progress)
      for (const [gi, goal] of taskIds.entries()) for (const t of goal) {
        if (current && gi === 2) continue;
        const to = t.fullyDone || t.partial ? "DONE" : "NOT_DONE";
        must(await sb.from("tasks").update({ status: to }).eq("id", t.id), "task status");
        must(await sb.from("task_status_history").insert({ task_id: t.id, from_status: "UNDEFINED", to_status: to, change_source: "BU_LEAD_EXECUTION", changed_by: admin.id }), "task history");
      }
      await rpc("set_report_comment", { p_actor: admin.id, p_report_id: reportId, p_comment: `**Week ${w.week_number} for ${u.name}**\n\n- ${taskIds.flat().filter((t) => t.fullyDone || t.partial).length} of ${taskIds.flat().length} tasks done\n- _Main blocker:_ partner availability\n- Need from leadership: ++a decision on the open items++` });
      if (!current) await rpc("submit_weekly_report", { p_actor: admin.id, p_report_id: reportId, p_summary_comment: null, p_expected_version: null });
      await rpc("release_edit_lease", { p_actor: admin.id, p_report_id: reportId });
      process.stdout.write(`${u.code} W${w.week_number} `);
    }
    process.stdout.write("\n");
    writeManifest(manifest);
  }
  writeManifest(manifest);
  console.log(`Seeded ${units.length} units, ${manifest.buGoalIds.length} BU goals, ${manifest.reportIds.length} reports. Manifest: ${MANIFEST}`);
}

/** Deletes what `add` created. Past the application's own rules on purpose (reports and goals are normally immutable), so it runs as the database owner with triggers off. */
function remove() {
  const m = readManifest();
  if (!m) { console.error("No manifest at", MANIFEST, "- nothing to remove."); process.exit(1); }
  console.log("Backup:", backupRealDatabase());
  const ids = (a: string[]) => (a.length ? a.map((i) => `'${i}'`).join(",") : "null");
  const report = ids(m.reportIds), goals = `select id from smart_goals where weekly_report_id in (${report})`, tasks = `select id from tasks where smart_goal_id in (${goals})`;
  psql(`
    begin;
    set local session_replication_role = replica;
    delete from task_status_history where task_id in (${tasks});
    delete from smart_evaluations where smart_goal_id in (${goals});
    delete from tasks where smart_goal_id in (${goals});
    delete from smart_goals where weekly_report_id in (${report});
    delete from report_edit_sessions where weekly_report_id in (${report});
    delete from weekly_reports where id in (${report});
    delete from bu_goals where id in (${ids(m.buGoalIds)});
    update reporting_weeks set locks_suspended_at = null, locks_suspended_by = null, locks_suspended_reason = null where id in (${ids(m.suspendedWeekIds)});
    commit;
  `);
  writeFileSync(MANIFEST.replace(".json", `.removed-${Date.now()}.json`), JSON.stringify(m, null, 2));
  writeFileSync(MANIFEST, "null");
  console.log(`Removed ${m.reportIds.length} reports and ${m.buGoalIds.length} BU goals; restored the locks on ${m.suspendedWeekIds.length} weeks.`);
}

(mode === "add" ? add() : Promise.resolve(remove())).catch((e) => { console.error(e.message ?? e); process.exit(1); });
