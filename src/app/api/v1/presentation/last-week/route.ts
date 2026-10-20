import { z } from "zod";
import { api, fail, requirePerm } from "@/lib/api/handler";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

const query = z.object({ weekId: z.string().uuid(), buId: z.string().uuid() }).strict();

/**
 * "Last Week" presenter hint: the tasks recorded as Not Done in the week immediately before the one being presented, for one BU.
 * Strictly read-only. Needs `presentation.view`; the database function runs as the caller, so BU scope and row-level security
 * decide what is returned, and no privileged access path exists for this feature.
 */
export const GET = api({}, async ({ actor, req }) => {
  requirePerm(actor, "presentation.view");
  const sp = new URL(req.url).searchParams;
  const parsed = query.safeParse({ weekId: sp.get("weekId"), buId: sp.get("buId") });
  if (!parsed.success) throw fail("VALIDATION_ERROR", 422, "Choose a reporting week and a Business Unit.");
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_previous_week_outstanding", { p_week_id: parsed.data.weekId, p_bu_id: parsed.data.buId });
  if (error) throw dbError(error, "previous week tasks");
  return data;
});
