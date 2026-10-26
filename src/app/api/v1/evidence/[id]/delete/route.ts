import { z } from "zod";
import { api } from "@/lib/api/handler";
import { EvidenceIdParamsSchema } from "@/lib/validators/evidence";

/**
 * DELETE /api/v1/evidence/:id
 * Soft delete an evidence file.
 * Marks the record as deleted in the database (deleted_at, deleted_by).
 * Does NOT delete the file from Supabase Storage (to preserve audit trail).
 *
 * Returns: { data: { id, deletedAt } }
 */
export const DELETE = api(
  { body: z.object({}), stepUp: true },
  async ({ actor, params, rpc }) => {
    const result = await rpc("ops_delete_evidence_file", {
      p_actor: actor.id,
      p_id: params.id,
    });
    return { id: params.id, deletedAt: new Date().toISOString() };
  }
);