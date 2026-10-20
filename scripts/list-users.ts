import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function listUsers() {
  const { data: employees, error } = await sb
    .from("employees")
    .select(`
      id,
      email,
      first_name,
      last_name,
      employment_status,
      business_units(name, code)
    `)
    .order("email");

  if (error) {
    console.error("Error:", error);
    return;
  }

  const { data: users } = await sb.from("users").select("id, email, status");
  const userMap = new Map((users || []).map((u: any) => [u.email, u]));

  console.log("Employees & Users in the application:");
  console.log("=====================================\n");

  for (const emp of employees || []) {
    const user: any = userMap.get(emp.email);
    const bu = emp.business_units ? `${(emp.business_units as any).name} (${(emp.business_units as any).code})` : "N/A";
    console.log(`${emp.email}`);
    console.log(`  Name: ${emp.first_name} ${emp.last_name}`);
    console.log(`  Employment: ${emp.employment_status}`);
    console.log(`  App User Status: ${user ? user.status : "NO APP USER"}`);
    console.log(`  BU: ${bu}`);
    console.log("");
  }
}

listUsers();