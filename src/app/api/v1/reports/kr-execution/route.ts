import "server-only";
import { api } from "@/lib/api/handler";
import { can, requireActor } from "@/lib/auth/actor";
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
    return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403 });
  }

  let quarterId = new URL(req.url).searchParams.get("quarterId");

  // If no quarterId provided, use active quarter
  if (!quarterId) {
    const active = await currentQuarter();
    if (!active) {
      return new Response(JSON.stringify({ error: "No active quarter" }), { status: 404 });
    }
    quarterId = active.id;
  }

  // Validate quarter exists
  const quarters = await listQuarters();
  const quarter = quarters.find((q) => q.id === quarterId);
  if (!quarter) {
    return new Response(JSON.stringify({ error: "Quarter not found" }), { status: 404 });
  }

  // Call the RPC function
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_report_kr_execution", { p_quarter_id: quarterId });
  if (error) throw dbError(error, "read_report_kr_execution");

  return { quarter: { id: quarter.id, quarter_number: quarter.quarter_number, year: quarter.year }, data: data ?? [] };
});