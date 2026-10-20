/**
 * Loads the organisation's real set-up from scripts/data/organisation.json into an organisation that has just been bootstrapped
 * (`npm run bootstrap`, or a database reset followed by it): Business Units, people, annual themes and the quarterly strategy.
 *
 *  - Business Units and people go through the same audited database functions the Import screens use (commit_business_unit_import is not
 *    needed: units are created with create_business_unit; employees with commit_employee_import).
 *  - People marked login_and_attendance also get a sign-in account with the BU_LEAD role and a one-time set-your-password link written to
 *    .local/setup-links.json (git-ignored). No password is chosen for anyone. People marked attendance_only are employees without an account.
 *  - Quarters that have already ended are stored as LOCKED, with their strategy, exactly as the historical import does, so the strategy can be
 *    attached to historical weekly reports. The application's normal strategy functions refuse to edit an ended quarter, hence direct inserts
 *    in one transaction, with an audit entry.
 *
 * Refuses to run against a database that already has units other than the bootstrap unit. Run: npm run org:load
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

config({ path: ".env.local" });

interface QuarterData { year: number; quarter: number; objective: string; krs: { title: string; subs: string[] }[] }
interface Data { units: { code: string; name: string; type: "BUSINESS_UNIT" | "DEPARTMENT"; reportsWeekly: boolean }[]; people: [string, string, string, string, string][]; themes: Record<string, string>; quarters: QuarterData[] }
const data = JSON.parse(readFileSync("scripts/data/organisation.json", "utf8")) as Data;

const need = (k: string): string => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(1); } return v; };
const sb = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

async function main() {
  const { data: grantors } = await sb.rpc("users_with_permission", { p_code: "roles.manage" });
  const actor = (grantors as string[] | null)?.[0];
  if (!actor) throw new Error("Nobody can manage roles yet. Run `npm run bootstrap` first.");
  const { data: existing } = await sb.from("business_units").select("id, code");
  if ((existing ?? []).length > 1) throw new Error("This organisation already has Business Units. Nothing was changed.");
  for (const u of data.units) {
    // the bootstrap unit (the administration unit the first Super Admin sits in) already exists: only its type and reporting flag are set
    let id = (existing ?? []).find((e) => e.code === u.code)?.id as string | undefined;
    if (!id) id = must(await sb.rpc("create_business_unit", { p_actor: actor, p_code: u.code, p_name: u.name, p_reports_weekly: u.reportsWeekly }), `unit ${u.code}`) as string;
    must(await sb.from("business_units").update({ unit_type: u.type, reports_weekly: u.reportsWeekly }).eq("id", id), `unit type ${u.code}`);
  }

  const rows = data.people.map(([firstName, lastName, businessUnit, email]) => ({ firstName, lastName, businessUnit, email: email.toLowerCase(), status: "" }));
  const sha = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  must(await sb.rpc("commit_employee_import", { p_actor: actor, p_rows: rows, p_policy: "ABORT_ON_CONFLICT", p_idempotency_key: `org-load-${sha.slice(0, 16)}`, p_file_name: "organisation.json", p_file_sha256: sha }), "employees");

  const links: Record<string, string | null> = {};
  for (const [first, last, unit, rawEmail, kind] of data.people) {
    if (kind !== "login_and_attendance") continue;
    const email = rawEmail.toLowerCase();
    const bu = must(await sb.from("business_units").select("id").eq("name", unit).single(), `unit ${unit}`) as { id: string };
    const { randomBytes } = await import("node:crypto");
    const created = await sb.auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`${email}: ${created.error?.message}`);
    const { error } = await sb.rpc("provision_user", { p_actor: actor, p_auth_id: created.data.user.id, p_email: email, p_first: first, p_last: last, p_bu: bu.id, p_roles: ["BU_LEAD"] });
    if (error) { await sb.auth.admin.deleteUser(created.data.user.id); throw new Error(`${email}: ${error.message}`); }
    const link = await sb.auth.admin.generateLink({ type: "recovery", email });
    links[email] = link.data?.properties?.action_link ?? null;
  }
  mkdirSync(".local", { recursive: true });
  writeFileSync(".local/setup-links.json", JSON.stringify(links, null, 2));

  for (const [year, theme] of Object.entries(data.themes)) must(await sb.rpc("create_annual_theme", { p_actor: actor, p_year: Number(year), p_theme: theme }), `theme ${year}`);

  const pg = new Client({ connectionString: process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
  await pg.connect();
  try {
    await pg.query("begin");
    const org = (await pg.query("select id from organisations limit 1")).rows[0].id as string;
    let nObj = 0, nKr = 0, nSub = 0;
    for (const q of data.quarters) {
      const start = `${q.year}-${String((q.quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
      const ended = (await pg.query("select (app_now() >= ((($1::date + interval '3 months')::date)::timestamp at time zone 'Africa/Lagos')) as ended", [start])).rows[0].ended as boolean;
      if (!ended) throw new Error(`${q.year} Q${q.quarter} has not ended; load it through the application so it follows the normal approval rules.`);
      const qid = (await pg.query(
        `insert into quarters (organisation_id, year, quarter_number, starts_on, ends_on, status, activated_at, locked_at)
         values ($1, $2, $3, $4::date, ($4::date + interval '3 months' - interval '1 day')::date, 'LOCKED', $4::date::timestamp at time zone 'Africa/Lagos', app_now())
         on conflict (organisation_id, year, quarter_number) do update set status = 'LOCKED' returning id`, [org, q.year, q.quarter, start])).rows[0].id as string;
      const obj = (await pg.query("insert into quarterly_objectives (quarter_id, title, created_by) values ($1, $2, $3) returning id", [qid, q.objective, actor])).rows[0].id as string;
      nObj++;
      for (const [i, kr] of q.krs.entries()) {
        const krId = (await pg.query("insert into key_results (objective_id, sequence, code, title) values ($1, $2, $3, $4) returning id", [obj, i + 1, `KR${i + 1}`, kr.title])).rows[0].id as string;
        nKr++;
        for (const [j, sub] of kr.subs.entries()) { await pg.query("insert into sub_key_results (key_result_id, sequence, code, title) values ($1, $2, $3, $4)", [krId, j + 1, `KR${i + 1}.${j + 1}`, sub]); nSub++; }
      }
    }
    await pg.query("select write_audit($1, 'STRATEGY_LOADED', 'organisation', $2, null, $3::jsonb)", [actor, org, JSON.stringify({ quarters: data.quarters.length, objectives: nObj, key_results: nKr, sub_key_results: nSub, source: "scripts/data/organisation.json" })]);
    // starting violation types (owner decision: preload three, the rest are entered by hand); fines are the old app's fine types, NGN
    const types: [string, string, string, number][] = [["PHONE", "Phone violation", "MEDIUM", 5000], ["LATE", "Late coming", "LOW", 3000], ["ABSENT", "Absent", "MEDIUM", 5000]];
    for (const [code, name, crit, fine] of types) await pg.query("insert into violation_types (code, name, criticality, default_fine) values ($1, $2, $3, $4) on conflict (code) do nothing", [code, name, crit, fine]);
    await pg.query("select write_audit($1, 'VIOLATION_TYPES_LOADED', 'organisation', $2, null, $3::jsonb)", [actor, org, JSON.stringify({ types: types.map((t) => t[0]) })]);
    await pg.query("commit");
    console.log(`Loaded ${data.units.length} units, ${data.people.length} people (${Object.keys(links).length} with sign-in), ${Object.keys(data.themes).length} themes, ${nObj} quarters with ${nKr} key results and ${nSub} Sub-KRs.`);
    console.log("One-time set-password links are in .local/setup-links.json (git-ignored).");
  } catch (e) {
    await pg.query("rollback");
    throw e;
  } finally {
    await pg.end();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
