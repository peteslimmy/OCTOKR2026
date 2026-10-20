import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  const { data: users, error } = await sb
    .from("users")
    .select("id, email, status, user_roles(roles(code))")
    .eq("email", "peteslimmy@gmail.com")
    .single();

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log("User:", JSON.stringify(users, null, 2));
}

main();