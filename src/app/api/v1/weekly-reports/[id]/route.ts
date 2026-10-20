import { api, fail } from "@/lib/api/handler";

/**
 * Get a weekly report view (existing GET handler)
 */
export const GET = api({}, async ({ params }) => {
  const { getReportView } = await import("@/lib/data");
  const view = await getReportView(params.id);
  if (!view) throw fail("NOT_FOUND", 404, "That record was not found.");
  return view;
});

/**
 * Delete a draft weekly report (NOT_SUBMITTED, OPEN state only).
 * Requires weekly_report.create permission.
 */
export const DELETE = api({}, async ({ actor, params, rpc }) =>
  rpc("delete_weekly_report", { p_actor: actor.id, p_report_id: params.id }));