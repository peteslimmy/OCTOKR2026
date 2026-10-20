import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

config({ path: ".env.local" });

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const EMAIL = "peteslimmy@gmail.com";
const PASSWORD = "Xodmansky%12";
const FIRST_NAME = "Pete";
const LAST_NAME = "Slimmy";
const ORG_NAME = "4CORE";
const ORG_CODE = "4CORE";
const BU_CODE = "HQ";
const BU_NAME = "Headquarters";

async function main() {
  // 1. Check if organisation already exists
  const { data: existingOrg } = await sb.from("organisations").select("id").maybeSingle();
  if (existingOrg) {
    console.log("Organisation already exists:", existingOrg.id);
    return;
  }

  // 2. Create auth user
  const { data: authUser, error: authError } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    throw new Error(`Failed to create auth user: ${authError?.message}`);
  }
  console.log("Created auth user:", authUser.user.id);

  // 3. Bootstrap organisation with superadmin
  const { data: bootstrap, error: bootstrapError } = await sb.rpc("bootstrap_organisation", {
    p_org_name: ORG_NAME,
    p_org_code: ORG_CODE,
    p_bu_code: BU_CODE,
    p_bu_name: BU_NAME,
    p_admin_auth_id: authUser.user.id,
    p_admin_email: EMAIL,
    p_admin_first: FIRST_NAME,
    p_admin_last: LAST_NAME,
  });

  if (bootstrapError) {
    throw new Error(`Bootstrap failed: ${bootstrapError.message}`);
  }

  console.log("Bootstrap result:", JSON.stringify(bootstrap, null, 2));
  console.log("\nSuperadmin created successfully!");
  console.log(`Email: ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log(`Business Unit: ${BU_NAME} (${BU_CODE})`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});