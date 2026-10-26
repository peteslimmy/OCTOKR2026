import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { deriveViolationTypeCode } from "@/lib/violations/type-code";
import { requestConfigChange } from "@/lib/api/config-request";
import { listViolationTypes } from "@/lib/data/governance";

/** Adding a violation type is a request that a different Admin or Super Admin approves (ADR-068). */
export const POST = api(
  { body: z.object({ code: z.string().trim().min(2).max(30).optional(), name: z.string().trim().min(1).max(500), criticality: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), defaultFine: z.number().positive().max(1_000_000_000), reason: z.string().trim().min(1).max(2000) }) },
  async (ctx) => {
    const { name, criticality, defaultFine, reason } = ctx.body;
    // the code is made from the name; two names that differ only by punctuation or case are the same type
    const code = (ctx.body.code ?? deriveViolationTypeCode(name)).toUpperCase();
    if ((await listViolationTypes()).some((t) => t.code === code)) throw fail("VALIDATION_ERROR", 422, "A violation type with this name (or a very similar one) already exists.");
    return requestConfigChange(ctx, "VIOLATION_TYPE", code, { action: "CREATE", code, name, criticality, defaultFine }, reason);
  });

export const GET = api({}, async () => listViolationTypes());
