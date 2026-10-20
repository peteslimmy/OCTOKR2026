import { api, fail } from "@/lib/api/handler";
import { REPORTS_VERSION, reportById } from "@/lib/reports/catalogue";
import { savedBody } from "@/lib/reports/access";

export const PATCH = api({ body: savedBody }, async ({ actor, body, params, rpc }) => {
  if (!reportById(body.reportId)) throw fail("REPORT_NOT_FOUND", 404, "That report does not exist.");
  const id = await rpc<string>("save_report", {
    p_actor: actor.id, p_id: params.id, p_name: body.name, p_report_id: body.reportId, p_version: REPORTS_VERSION, p_params: body.params,
    p_columns: body.columns ?? null, p_sort: body.sortBy ?? null, p_shared_with: body.sharedWith,
  });
  return { id };
});

export const DELETE = api({}, async ({ actor, params, rpc }) => {
  await rpc("delete_saved_report", { p_actor: actor.id, p_id: params.id });
  return { ok: true };
});
