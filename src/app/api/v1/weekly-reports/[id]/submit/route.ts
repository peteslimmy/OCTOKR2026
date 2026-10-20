import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ summaryComment: z.string().trim().max(4000).nullish(), expectedVersion: z.number().int().nullish() }) }, async ({ actor, body, params, rpc }) =>
  rpc("submit_weekly_report", { p_actor: actor.id, p_report_id: params.id, p_summary_comment: body.summaryComment ?? null, p_expected_version: body.expectedVersion ?? null }));
