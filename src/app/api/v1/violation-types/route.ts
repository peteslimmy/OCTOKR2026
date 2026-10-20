import { z } from "zod";
import { api } from "@/lib/api/handler";
import { requestConfigChange } from "@/lib/api/config-request";
import { listViolationTypes } from "@/lib/data/governance";

/** Adding a violation type is a request that a different Admin or Super Admin approves (ADR-068). */
export const POST = api(
  { body: z.object({ code: z.string().trim().min(2).max(30), name: z.string().trim().min(1).max(500), criticality: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), defaultFine: z.number().positive().max(1_000_000_000), reason: z.string().trim().min(1).max(2000) }) },
  async (ctx) => {
    const { code, name, criticality, defaultFine, reason } = ctx.body;
    return requestConfigChange(ctx, "VIOLATION_TYPE", code.toUpperCase(), { action: "CREATE", code, name, criticality, defaultFine }, reason);
  });

export const GET = api({}, async () => listViolationTypes());
