import "server-only";
import { api, fail } from "@/lib/api/handler";
import { can } from "@/lib/auth/actor";
import { currentQuarter, listQuarters } from "@/lib/data";
import { userClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/data/errors";

/**
 * GET /api/v1/reports/kr-execution?quarterId=<uuid>
 * Returns per-Sub-KR per-week execution data from read_report_kr_execution RPC.
 * Requires reports.view permission.
 */
export const GET = api({}, async ({ actor, req }) => {
  // Require reports.view permission
  if (!can(actor, "reports.view")) {
    throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  }

  let quarterId = new URL(req.url).searchParams.get("quarterId");

  // If no quarterId provided, use active quarter
  if (!quarterId) {
    const active = await currentQuarter();
    if (!active) {
      throw fail("NOT_FOUND", 404, "There is no active quarter.");
    }
    quarterId = active.id;
  }

  // Validate quarter exists
  const quarters = await listQuarters();
  const quarter = quarters.find((q) => q.id === quarterId);
  if (!quarter) {
    throw fail("NOT_FOUND", 404, "Quarter not found.");
  }

  // Call the RPC function
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_report_kr_execution", { p_quarter_id: quarterId });
  if (error) throw dbError(error, "read_report_kr_execution");

  return { quarter: { id: quarter.id, quarter_number: quarter.quarter_number, year: quarter.year }, data: data ?? [] };
});