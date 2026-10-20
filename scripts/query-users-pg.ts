import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const client = new Client({ connectionString: process.env.DB_URL });
  await client.connect();

  console.log("=== Organizations ===");
  const orgs = await client.query("select id, name, code, status from organisations");
  console.table(orgs.rows);

  console.log("\n=== Business Units ===");
  const bus = await client.query("select id, code, name, status, reports_weekly from business_units order by code");
  console.table(bus.rows);

  console.log("\n=== Users with Roles and Employees ===");
  const users = await client.query(`
    select
      u.email,
      e.first_name || ' ' || e.last_name as full_name,
      u.status as user_status,
      bu.name as business_unit,
      string_agg(r.code, ', ') as roles
    from users u
    left join employees e on e.id = u.employee_id
    left join business_units bu on bu.id = e.business_unit_id
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    group by u.email, e.first_name, e.last_name, u.status, bu.name
    order by u.email
  `);
  console.table(users.rows);

  console.log("\n=== Auth Users ===");
  const authUsers = await client.query("select id, email, created_at from auth.users order by email");
  console.table(authUsers.rows);

  await client.end();
}

main().catch(console.error);