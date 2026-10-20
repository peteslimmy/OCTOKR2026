/**
 * One-time production bootstrap: creates the organisation, its first Business Unit and the first SuperAdmin.
 * Nothing here is demo data. Secrets are read from the environment, never from the repository.
 *
 *   BOOTSTRAP_ORG_NAME="Acme" BOOTSTRAP_ORG_CODE=ACME BOOTSTRAP_BU_CODE=HQ BOOTSTRAP_BU_NAME="Headquarters" \
 *   BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_FIRST=... BOOTSTRAP_ADMIN_LAST=... BOOTSTRAP_ADMIN_PASSWORD=... \
 *   npm run bootstrap
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing ${k}`);
    process.exit(1);
  }
  return v;
};

async function main() {
  const sb = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const password = need("BOOTSTRAP_ADMIN_PASSWORD");
  if (password.length < 12) {
    console.error("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters");
    process.exit(1);
  }
  const email = need("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message ?? "could not create admin identity");
  const { data, error } = await sb.rpc("bootstrap_organisation", {
    p_org_name: need("BOOTSTRAP_ORG_NAME"), p_org_code: need("BOOTSTRAP_ORG_CODE"), p_bu_code: need("BOOTSTRAP_BU_CODE"), p_bu_name: need("BOOTSTRAP_BU_NAME"),
    p_admin_auth_id: created.data.user.id, p_admin_email: email, p_admin_first: need("BOOTSTRAP_ADMIN_FIRST"), p_admin_last: need("BOOTSTRAP_ADMIN_LAST"),
  });
  if (error) {
    await sb.auth.admin.deleteUser(created.data.user.id);
    throw new Error(error.message);
  }
  console.log("Bootstrapped:", data);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
