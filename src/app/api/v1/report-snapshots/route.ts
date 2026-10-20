import { api, fail } from "@/lib/api/handler";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

/** Snapshot index (no result bodies), visible only to organisation-wide report holders by row-level security. */
export const GET = api({}, async ({ actor }) => {
  if (!actor.permissions.has("reports.view")) throw fail("REPORT_NOT_AVAILABLE", 403, "You do not have access to this report.");
  const sb = await userClient();
  const { data, error } = await sb.from("report_snapshots")
    .select("id, report_id, definition_version, title, params, scope, row_count, checksum, generated_at, note").order("generated_at", { ascending: false }).limit(200);
  if (error) throw dbError(error, "snapshots");
  return data ?? [];
});
