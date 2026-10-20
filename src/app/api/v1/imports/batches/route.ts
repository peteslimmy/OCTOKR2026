import { api, requirePerm } from "@/lib/api/handler";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

/** Recent imports (who, when, which file, what happened). Read-only; row-level security limits it to people who can manage users. */
export const GET = api({}, async ({ actor }) => {
  if (!actor.permissions.has("users.manage") && !actor.permissions.has("business_units.manage")) requirePerm(actor, "users.manage");
  const sb = await userClient();
  const { data, error } = await sb.from("import_batches")
    .select("id, entity, file_name, policy, row_count, created_count, updated_count, unchanged_count, skipped_count, committed_at, users(email)")
    .order("committed_at", { ascending: false }).limit(20);
  if (error) throw dbError(error, "import batches");
  return data;
});
