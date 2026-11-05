/**
 * TEMPORARY test accounts, one per role, so every screen can be tried end to end from the browser. Local Supabase only.
 *
 *   npm run sim:add      creates sim.<role>@sim.local users in a separate "Simulation" unit (your real units and reports are untouched)
 *   npm run sim:remove   deletes them again (through delete_user, so it is audited) and removes the Simulation unit's accounts
 *
 * The passwords are random, written to .local/simulated-accounts.txt (git-ignored) and never printed. Roles that need an authenticator
 * (Admin, Finance) are enrolled here; get the current code with `npm run dev:totp -- <email>`.
 */
import { config } from "dotenv";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { DEV_MFA_FILE, totp } from "./totp";

config({ path: ".env.local" });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(URL_)) { console.error("Refusing to run against a non-local Supabase URL."); process.exit(1); }
const sb = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FILE = ".local/simulated-accounts.txt";
const BU_CODE = "SIM";

const PEOPLE: [string, string, string[]][] = [
  ["bu-lead", "Bola", ["BU_LEAD"]],
  ["hr", "Hadiza", ["HR"]],
  ["finance", "Femi", ["FINANCE"]],
  ["admin", "Ade", ["ADMIN"]],
  ["presenter", "Pat", ["PRESENTER"]],
  ["executive", "Eve", ["EXECUTIVE"]],
  ["director", "Dan", ["DIRECTOR"]],
];
const emailOf = (k: string) => `sim.${k}@sim.local`;
const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

async function actor(): Promise<string> {
  const { data } = await sb.rpc("users_with_permission", { p_code: "roles.manage" });
  const id = (data as string[] | null)?.[0];
  if (!id) throw new Error("Nobody active can manage roles.");
  return id;
}

async function add() {
  const by = await actor();
  let bu = (await sb.from("business_units").select("id").eq("code", BU_CODE).maybeSingle()).data as { id: string } | null;
  if (!bu) bu = { id: must(await sb.rpc("create_business_unit", { p_actor: by, p_code: BU_CODE, p_name: "Simulation (temporary)" }), "unit") as string };
  const lines: string[] = [];
  const secrets: Record<string, string> = existsSync(DEV_MFA_FILE) ? JSON.parse(readFileSync(DEV_MFA_FILE, "utf8")) : {};
  for (const [key, first, roles] of PEOPLE) {
    const email = emailOf(key);
    if ((await sb.from("users").select("id").eq("email", email).maybeSingle()).data) { lines.push(`${email}  (already exists; password unchanged)`); continue; }
    const password = randomBytes(9).toString("base64url") + "aA1!";
    // a sign-in left over from an earlier simulation (removing the user keeps the identity): clear it so the account can be made again
    const { data: old } = await sb.auth.admin.listUsers({ perPage: 200 });
    const stale = old?.users.find((u) => u.email === email);
    if (stale) await sb.auth.admin.deleteUser(stale.id);
    const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(created.error?.message);
    const { error } = await sb.rpc("provision_user", { p_actor: by, p_auth_id: created.data.user.id, p_email: email, p_first: first, p_last: "Sim", p_bu: bu.id, p_roles: roles });
    if (error) { await sb.auth.admin.deleteUser(created.data.user.id); throw new Error(`${email}: ${error.message}`); }
    if (roles.some((r) => ["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(r))) {
      const user = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const si = await user.auth.signInWithPassword({ email, password });
      if (si.error) throw new Error(`${email} sign-in: ${si.error.message}`);
      const enrol = await user.auth.mfa.enroll({ factorType: "totp", issuer: "4CORE-OKR (sim)" });
      if (enrol.error || !enrol.data) throw new Error(`${email} enrol: ${enrol.error?.message}`);
      const v = await user.auth.mfa.challengeAndVerify({ factorId: enrol.data.id, code: totp(enrol.data.totp.secret) });
      if (v.error) throw new Error(`${email} verify: ${v.error.message}`);
      secrets[email] = enrol.data.totp.secret;
      await user.auth.signOut();
    }
    lines.push(`${email}  ${password}  ${roles.join("+")}${secrets[email] ? "  (needs a code: npm run dev:totp -- " + email + ")" : ""}`);
  }
  writeFileSync(DEV_MFA_FILE, JSON.stringify(secrets, null, 2));
  mkdirSync(".local", { recursive: true });
  writeFileSync(FILE, `Temporary simulated accounts (remove with: npm run sim:remove)\n${lines.join("\n")}\n`);
  console.log(`Created or kept ${PEOPLE.length} simulated accounts. Details are in ${FILE}.`);
}

async function remove() {
  const by = await actor();
  let n = 0;
  for (const [key] of PEOPLE) {
    const email = emailOf(key);
    const u = (await sb.from("users").select("id").eq("email", email).maybeSingle()).data as { id: string } | null;
    if (!u) continue;
    must(await sb.rpc("delete_user", { p_actor: by, p_user: u.id, p_reason: "Temporary simulated test account removed" }), email);
    n++;
  }
  console.log(`Removed ${n} simulated accounts. The "Simulation (temporary)" unit stays (empty) until you deactivate it in Business Units.`);
}

(process.argv[2] === "remove" ? remove() : add()).catch((e) => { console.error(e.message ?? e); process.exit(1); });
