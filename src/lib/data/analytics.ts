import "server-only";
import { normaliseCells, type Cell } from "@/lib/analytics";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

/** One row per unit per reporting week of the quarter, limited by row-level security to the units the caller may see. */
export async function getDashboardCells(quarterId: string): Promise<Cell[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_dashboard_cells", { p_quarter_id: quarterId });
  if (error) throw dbError(error, "dashboard analytics");
  return normaliseCells(data);
}
