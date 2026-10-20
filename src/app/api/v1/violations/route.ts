import { z } from "zod";
import { api } from "@/lib/api/handler";
import { listViolations } from "@/lib/data/governance";

export const POST = api({ body: z.object({ employeeId: z.string().uuid(), governanceSessionId: z.string().uuid().nullish(), violationTypeId: z.string().uuid(), fineOverride: z.number().positive().max(1_000_000_000).nullish(), overrideReason: z.string().trim().max(2000).nullish(), notes: z.string().trim().max(2000).nullish(), idempotencyKey: z.string().min(8).max(100) }) }, async ({ actor, body, rpc }) =>
  rpc("create_violation", { p_actor: actor.id, p_employee: body.employeeId, p_session: body.governanceSessionId ?? null, p_type: body.violationTypeId, p_fine_override: body.fineOverride ?? null, p_override_reason: body.overrideReason ?? null, p_notes: body.notes ?? null, p_idempotency_key: body.idempotencyKey }));

export const GET = api({}, async () => listViolations());
