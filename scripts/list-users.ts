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
  const userMap = new Map<string, string | null>();
  for (const u of users ?? []) userMap.set(u.email, u.status);

  console.log("Employees & Users in the application:");
  console.log("=====================================\n");

  for (const emp of employees || []) {
    const status = userMap.get(emp.email);
    const buRows: { name: string; code: string }[] = Array.isArray(emp.business_units)
      ? emp.business_units
      : [];
    const bu = buRows[0] ? `${buRows[0].name} (${buRows[0].code})` : "N/A";
    console.log(`${emp.email}`);
    console.log(`  Name: ${emp.first_name} ${emp.last_name}`);
    console.log(`  Employment: ${emp.employment_status}`);
    console.log(`  App User Status: ${status === undefined ? "NO APP USER" : status}`);
    console.log(`  BU: ${bu}`);
    console.log("");
  }
}

listUsers();