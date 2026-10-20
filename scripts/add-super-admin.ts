/**
 * Adds one more person who can manage roles (a Super Admin) to an organisation that already exists.
 * It is the same step as Administration → Users, done from the command line, for the case where nobody is signed in yet.
 * The person is created through the database function `provision_user`, acting as an existing active holder of `roles.manage`, so the same
 * checks and the audit entry apply. The password is read from the environment and is never printed or stored in the repository.
 *
 *   ADD_ADMIN_EMAIL=name@example.com ADD_ADMIN_PASSWORD=... [ADD_ADMIN_FIRST=Name ADD_ADMIN_LAST=Surname ADD_ADMIN_ROLE=SUPER_ADMIN ADD_ADMIN_BU=HQ] \
 *   npm run admin:add
 *
 * Super Admin needs an authenticator app: the person is asked to set one up the first time they sign in.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
  return v;
};

async function main() {
  const sb = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const email = need("ADD_ADMIN_EMAIL").trim().toLowerCase();
  const password = need("ADD_ADMIN_PASSWORD");
  const role = (process.env.ADD_ADMIN_ROLE ?? "SUPER_ADMIN").trim().toUpperCase();
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    console.error("The password needs at least 12 characters with a capital letter, a small letter and a digit."); process.exit(1);
  }
  const local = email.split("@")[0].replace(/[^a-zA-Z]+/g, " ").trim();
  const first = process.env.ADD_ADMIN_FIRST ?? (local.split(" ")[0] || "Admin");
  const last = process.env.ADD_ADMIN_LAST ?? (local.split(" ")[1] || "User");

  const existing = await sb.from("users").select("id").eq("email", email).maybeSingle();
  if (existing.data) { console.error(`${email} is already a user. Nothing was changed.`); process.exit(1); }

  // an existing active person who can manage roles acts as the grantor, so the normal rules and audit apply
  const { data: grantors } = await sb.rpc("users_with_permission", { p_code: "roles.manage" });
  const actor = (grantors as string[] | null)?.[0];
  if (!actor) { console.error("Nobody active can manage roles yet. Use `npm run bootstrap` to set up a new organisation."); process.exit(1); }

  const buCode = (process.env.ADD_ADMIN_BU ?? "").trim().toUpperCase();
  const bus = await sb.from("business_units").select("id, code, name").eq("status", "ACTIVE").order("code");
  const bu = (buCode ? bus.data?.find((b) => b.code === buCode) : bus.data?.find((b) => b.code === "HQ") ?? bus.data?.[0]);
  if (!bu) { console.error(`No active Business Unit${buCode ? ` with code ${buCode}` : ""}.`); process.exit(1); }

  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) { console.error(created.error?.message ?? "The identity could not be created."); process.exit(1); }
  const { error } = await sb.rpc("provision_user", { p_actor: actor, p_auth_id: created.data.user.id, p_email: email, p_first: first, p_last: last, p_bu: bu.id, p_roles: [role] });
  if (error) {
    await sb.auth.admin.deleteUser(created.data.user.id);
    console.error(`Not created: ${error.message}`); process.exit(1);
  }
  console.log(`Created ${email} as ${role} in ${bu.name} (${bu.code}). They will be asked to set up an authenticator app at first sign-in.`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
