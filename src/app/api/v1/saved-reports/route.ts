import { api, fail } from "@/lib/api/handler";
import { savedBody } from "@/lib/reports/access";
import { REPORTS_VERSION, reportById } from "@/lib/reports/catalogue";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";


/** Own and shared saved report configurations (row-level security). A saved report holds a definition, never data. */
export const GET = api({}, async ({ actor }) => {
  if (!actor.permissions.has("reports.view")) throw fail("REPORT_NOT_AVAILABLE", 403, "You do not have access to this report.");
  const sb = await userClient();
  const { data, error } = await sb.from("saved_reports").select("*").order("updated_at", { ascending: false });
  if (error) throw dbError(error, "saved reports");
  return (data ?? []).map((r) => ({ ...r, isOwner: r.owner_id === actor.id }));
});

export const POST = api({ body: savedBody }, async ({ actor, body, rpc }) => {
  if (!reportById(body.reportId)) throw fail("REPORT_NOT_FOUND", 404, "That report does not exist.");
  const id = await rpc<string>("save_report", {
    p_actor: actor.id, p_id: null, p_name: body.name, p_report_id: body.reportId, p_version: REPORTS_VERSION, p_params: body.params,
    p_columns: body.columns ?? null, p_sort: body.sortBy ?? null, p_shared_with: body.sharedWith,
  });
  return { id };
});
