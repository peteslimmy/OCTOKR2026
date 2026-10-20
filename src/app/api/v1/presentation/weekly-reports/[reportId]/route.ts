import { api, fail, requirePerm } from "@/lib/api/handler";
import { getReportView } from "@/lib/data";

export const GET = api({}, async ({ actor, params }) => {
  requirePerm(actor, "presentation.view");
  const view = await getReportView(params.reportId);
  if (!view) throw fail("NOT_FOUND", 404, "That record was not found.");
  return view;
});
