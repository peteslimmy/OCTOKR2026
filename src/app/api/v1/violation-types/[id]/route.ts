import { z } from "zod";
import { api } from "@/lib/api/handler";
import { requestConfigChange } from "@/lib/api/config-request";

/** Changing a violation type or its fine is a request that a different Admin or Super Admin approves. Violations already recorded keep their fine. */
export const PATCH = api(
  { body: z.object({ name: z.string().trim().min(1).max(500), criticality: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), defaultFine: z.number().positive().max(1_000_000_000), active: z.boolean(), reason: z.string().trim().min(1).max(2000) }) },
  async (ctx) => {
    const { name, criticality, defaultFine, active, reason } = ctx.body;
    return requestConfigChange(ctx, "VIOLATION_TYPE", ctx.params.id, { action: "UPDATE", name, criticality, defaultFine, active }, reason);
  });
