import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { explainReport } from "@/lib/ai/commentary";
import { aiStatus, complete } from "@/lib/ai/provider";
import { liveReportData } from "@/lib/ai/live-report-data";
import { reportById } from "@/lib/ai/reports";
import { can } from "@/lib/auth/actor";
import { adminClient } from "@/lib/supabase/admin";

/** POST /api/v1/ai/reports/{id}/commentary { quarter?, unit? } — an optional written explanation of a report, shown only if every figure in it is in the report. Never an error: no commentary is a normal answer. */
export const POST = api({ body: z.object({ quarter: z.string().max(20).optional(), unit: z.string().max(80).optional() }) }, async ({ actor, body, params }) => {
  const def = reportById(params.id);
  if (!def) throw fail("NOT_FOUND", 404, "That report does not exist.");
  if (!can(actor, "ai.assistant.use")) throw fail("PERMISSION_DENIED", 403, "You do not have access to the assistant.");
  const status = await aiStatus(actor.id).catch(() => null);
  if (!status?.enabled) throw fail("AI_DISABLED", 403, "The AI Performance Agent is not switched on.");
  const data = liveReportData();
  const res = await def.build({ asker: { id: actor.id, buId: actor.buId, permissions: actor.permissions }, data, now: () => new Date() }, body);
  if ("error" in res) throw fail("PERMISSION_DENIED", 403, res.error);
  const pseud = await adminClient().rpc("ai_setting", { p_key: "pseudonymise_prompts" });
  return explainReport({ complete, units: await data.units(), pseudonymise: pseud.data !== false, userId: actor.id }, res.report);
});
