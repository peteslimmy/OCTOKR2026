/**
 * LOCAL DEVELOPMENT ONLY. Creates a sample organisation, users and an active quarter so the app can be
 * explored and E2E-tested. Refuses to run against any non-local Supabase URL. Never used in production.
 * Idempotent: re-running reuses the existing organisation and users.
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEV_MFA_FILE, totp } from "./totp";

config({ path: ".env.local" });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(URL_)) {
  console.error("dev-seed refuses to run against a non-local Supabase URL:", URL_);
  process.exit(1);
}
if (process.env.OKR_TEST_STACK !== "1" && process.env.CI !== "true") {
  console.error("dev-seed writes SAMPLE data and only runs against the separate test stack, never your real database.\nUse: node scripts/test-stack.mjs run --seed -- <command>   (or npm run test:e2e)");
  process.exit(1);
}
export const DEV_PASSWORD ="DevPassword!2026"; // local-only credential, documented in README

const sb: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function authUser(email: string): Promise<string> {
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data, error } = await sb.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message);
  return data.user.id;
}

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};


/**
 * Roles that must use an authenticator (SUPER_ADMIN, ADMIN, FINANCE) cannot sign in without one, so the seed enrols a TOTP factor
 * for each of them and records the secret in a git-ignored local file. `npm run dev:totp -- <email>` prints the current code.
 */
async function enrolElevatedUsers() {
  const { data: rows } = await sb.from("users").select("id, email, user_roles!user_roles_user_id_fkey(roles(code))");
  const elevated = ((rows ?? []) as unknown as { id: string; email: string; user_roles: { roles: { code: string } | null }[] }[])
    .filter((u) => u.user_roles.some((r) => r.roles && ["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(r.roles.code)));
  const secrets: Record<string, string> = existsSync(DEV_MFA_FILE) ? JSON.parse(readFileSync(DEV_MFA_FILE, "utf8")) : {};
  for (const u of elevated) {
    const { data: f } = await sb.auth.admin.mfa.listFactors({ userId: u.id });
    const verified = (f?.factors ?? []).filter((x) => x.status === "verified");
    if (verified.length && secrets[u.email]) continue;
    for (const x of f?.factors ?? []) await sb.auth.admin.mfa.deleteFactor({ id: x.id, userId: u.id });   // lost secret: start over
    const user = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const signedIn = await user.auth.signInWithPassword({ email: u.email, password: DEV_PASSWORD });
    if (signedIn.error) throw new Error(`mfa enrol sign-in ${u.email}: ${signedIn.error.message}`);
    const enrol = await user.auth.mfa.enroll({ factorType: "totp", issuer: "4CORE-OKR (dev)" });
    if (enrol.error || !enrol.data) throw new Error(`mfa enrol ${u.email}: ${enrol.error?.message}`);
    const verify = await user.auth.mfa.challengeAndVerify({ factorId: enrol.data.id, code: totp(enrol.data.totp.secret) });
    if (verify.error) throw new Error(`mfa verify ${u.email}: ${verify.error.message}`);
    secrets[u.email] = enrol.data.totp.secret;
    await user.auth.signOut();
  }
  writeFileSync(DEV_MFA_FILE, JSON.stringify(secrets, null, 2));
}

async function main() {
  const { data: org } = await sb.from("organisations").select("id").maybeSingle();
  let hqBu: string;
  let superAdmin: string;
  if (!org) {
    superAdmin = await authUser("superadmin@4core.local");
    const r = must(await sb.rpc("bootstrap_organisation", {
      p_org_name: "4CORE (local dev)", p_org_code: "4CORE", p_bu_code: "HQ", p_bu_name: "Headquarters",
      p_admin_auth_id: superAdmin, p_admin_email: "superadmin@4core.local", p_admin_first: "Sam", p_admin_last: "Super",
    }), "bootstrap") as { business_unit_id: string };
    hqBu = r.business_unit_id;
  } else {
    superAdmin = await authUser("superadmin@4core.local");
    hqBu = (must(await sb.from("business_units").select("id").eq("code", "HQ").single(), "hq") as { id: string }).id;
  }

  const bu = async (code: string, name: string): Promise<string> => {
    const { data } = await sb.from("business_units").select("id").eq("code", code).maybeSingle();
    if (data) return (data as { id: string }).id;
    return must(await sb.rpc("create_business_unit", { p_actor: superAdmin, p_code: code, p_name: name }), "bu") as string;
  };
  // The HQ unit hosts administrators and files no weekly OKR report.
  await sb.from("business_units").update({ reports_weekly: false }).eq("id", hqBu);
  // Sample violation types (local development only; production types are defined by HR/Admin).
  for (const t of [
    { code: "LATE", name: "Late to OKR session", criticality: "LOW", default_fine: 1000 },
    { code: "NOSHOW", name: "Unexcused absence", criticality: "MEDIUM", default_fine: 5000 },
  ]) await sb.from("violation_types").upsert(t, { onConflict: "code" });
  const finance = await bu("FIN", "Finance");
  const hr = await bu("HR", "Human Resources");
  const eng = await bu("ENG", "Engineering");
  const sales = await bu("SALES", "Sales");

  // accounts exist only on approved email domains: the seed people use this one
  must(await sb.from("allowed_email_domains").upsert({ domain: "4core.local" }), "approve the seed domain");
  const people: [string, string, string, string, string[]][] = [
    ["admin@4core.local", "Ada", "Admin", hqBu, ["ADMIN"]],
    ["hr@4core.local", "Hana", "Resources", hr, ["HR", "BU_LEAD"]],
    ["finance@4core.local", "Femi", "Ledger", finance, ["FINANCE", "BU_LEAD"]],
    ["presenter@4core.local", "Pat", "Presenter", hqBu, ["PRESENTER"]],
    ["exec@4core.local", "Eve", "Executive", hqBu, ["EXECUTIVE"]],
    ["director@4core.local", "Dan", "Director", hqBu, ["DIRECTOR"]],
    ["lead.eng@4core.local", "Eli", "Engineer", eng, ["BU_LEAD"]],
    ["lead.eng2@4core.local", "Ezra", "Engineer", eng, ["BU_LEAD"]],
    ["lead.sales@4core.local", "Sade", "Seller", sales, ["BU_LEAD"]],
  ];
  for (const [email, first, last, buId, roles] of people) {
    const { data: exists } = await sb.from("users").select("id").eq("email", email).maybeSingle();
    if (exists) continue;
    const id = await authUser(email);
    must(await sb.rpc("provision_user", { p_actor: superAdmin, p_auth_id: id, p_email: email, p_first: first, p_last: last, p_bu: buId, p_roles: roles }), `user ${email}`);
  }

  // Strategy for the current calendar year and quarter
  const now = new Date();
  const year = now.getUTCFullYear();
  const qn = Math.floor(now.getUTCMonth() / 3) + 1;
  const { data: th } = await sb.from("annual_themes").select("id").eq("year", year).maybeSingle();
  if (!th) must(await sb.rpc("create_annual_theme", { p_actor: superAdmin, p_year: year, p_theme: "Build the foundations for durable growth" }), "theme");
  must(await sb.rpc("create_year_quarters", { p_actor: superAdmin, p_year: year }), "quarters");
  const q = must(await sb.from("quarters").select("id, status").eq("year", year).eq("quarter_number", qn).single(), "quarter") as { id: string; status: string };
  const { data: obj } = await sb.from("quarterly_objectives").select("id").eq("quarter_id", q.id).maybeSingle();
  if (!obj) {
    const o = must(await sb.rpc("create_objective", { p_actor: superAdmin, p_quarter_id: q.id, p_title: "Increase recurring revenue and delivery reliability", p_description: null }), "objective") as string;
    const krs: [string, string[]][] = [
      ["Grow qualified pipeline", ["Generate 120 qualified leads", "Convert 30% of leads to proposals"]],
      ["Improve customer retention", ["Reduce churn to 3%", "Run 20 customer success reviews"]],
      ["Deliver projects on time", ["Close 90% of milestones on schedule"]],
    ];
    for (const [title, subs] of krs) {
      const kr = must(await sb.rpc("create_key_result", { p_actor: superAdmin, p_objective_id: o, p_title: title, p_description: null }), "kr") as string;
      for (const s of subs) must(await sb.rpc("create_sub_key_result", { p_actor: superAdmin, p_kr_id: kr, p_title: s, p_description: null }), "subkr");
    }
  }
  if (q.status === "PLANNED") must(await sb.rpc("activate_quarter", { p_actor: superAdmin, p_quarter_id: q.id }), "activate");
  const { data: rate } = await sb.from("integrity_penalty_configurations").select("id").is("effective_to", null).maybeSingle();
  if (!rate) must(await sb.rpc("set_integrity_penalty_rate", { p_actor: superAdmin, p_rate: 0.05 }), "penalty rate");
  await enrolElevatedUsers();
  console.log(`Seeded local dev data. Sign in as any *@4core.local user with the dev password documented in README.md. SUPER_ADMIN, ADMIN and FINANCE also need a code: npm run dev:totp -- <email>.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
