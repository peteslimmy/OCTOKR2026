import { api } from "@/lib/api/handler";
import { requestConfigChange } from "@/lib/api/config-request";
import { z } from "zod";

/** Changing the integrity penalty rate is a request that a different Admin or Super Admin approves (ADR-068). */
export const POST = api(
  { stepUp: true, body: z.object({ rate: z.number().gt(0).max(1), reason: z.string().trim().min(1).max(2000) }) },
  async (ctx) => requestConfigChange(ctx, "PENALTY_RATE", null, { rate: ctx.body.rate }, ctx.body.reason));
