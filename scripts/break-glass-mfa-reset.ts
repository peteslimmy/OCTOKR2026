/**
 * BREAK-GLASS: resets one account's authenticator from the server, for the case where no Super Admin can sign in
 * (docs/26-ACCOUNT-RECOVERY.md). It removes the authenticator, revokes the unused recovery codes, ends every session of the account and
 * writes an audit entry and an alert naming the operator and the reason. It needs the server's own credentials, so it can only be run
 * by someone with access to the environment; it is not reachable from the application.
 *
 *   npm run break-glass:mfa-reset -- --email super@your-org.example --operator "Name, role" --reason "Both Super Admins lost their devices" --confirm super@your-org.example
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const operator = arg("operator")?.trim();
  const reason = arg("reason")?.trim();
  if (!email || !operator || !reason || reason.length < 10) throw new Error("Usage: --email <address> --operator \"<name, role>\" --reason \"<at least 10 characters>\" --confirm <address>");
  if (arg("confirm")?.trim().toLowerCase() !== email) throw new Error("Refusing to continue: repeat the address with --confirm to show this is deliberate.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: u, error: uerr } = await sb.from("users").select("id, email").eq("email", email).maybeSingle();
  if (uerr || !u) throw new Error(`No user with the address ${email}.`);
  const { data: factors, error: ferr } = await sb.auth.admin.mfa.listFactors({ userId: u.id });
  if (ferr) throw new Error(`Could not list authenticators: ${ferr.message}`);
  for (const f of factors?.factors ?? []) {
    const r = await sb.auth.admin.mfa.deleteFactor({ id: f.id, userId: u.id });
    if (r.error) throw new Error(`Could not remove an authenticator: ${r.error.message}`);
  }
  const rec = await sb.rpc("record_break_glass", { p_target: u.id, p_operator: operator, p_reason: reason });
  if (rec.error) throw new Error(`Could not record the break-glass action: ${rec.error.message}`);
  const ended = await sb.rpc("revoke_user_sessions", { p_user: u.id, p_keep: null });
  console.log(`Done. ${factors?.factors?.length ?? 0} authenticator(s) removed, ${ended.data ?? 0} session(s) ended, audit entry written. ${email} must set up a new authenticator at the next sign-in.`);
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
