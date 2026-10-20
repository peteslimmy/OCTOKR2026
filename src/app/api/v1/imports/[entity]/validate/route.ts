import { z } from "zod";
import { api, requirePerm } from "@/lib/api/handler";
import { entityFor, policySchema, readBody, rowsSchemaFor } from "@/lib/import/reference";
import { userClient } from "@/lib/supabase/server";

/**
 * Step 3 of an import: classifies every row against live data and says what would happen to it. Read-only. It can be called again
 * after each correction; the same rows always give the same answer.
 */
export const POST = api({}, async ({ actor, req, params }) => {
  const entity = entityFor(params.entity);
  requirePerm(actor, entity.permission);
  const body = await readBody(req, z.object({ rows: rowsSchemaFor(entity.id), policy: policySchema, fileSha256: z.string().regex(/^[0-9a-f]{64}$/).optional() }).strict());
  const out = await entity.validate(body.rows, body.policy);
  let alreadyImported: { committed_at: string; file_name: string } | null = null;
  if (body.fileSha256) {
    const sb = await userClient();
    const { data } = await sb.from("import_batches").select("committed_at, file_name").eq("file_sha256", body.fileSha256).order("committed_at", { ascending: false }).limit(1);
    alreadyImported = data?.[0] ?? null;
  }
  return { ...out, alreadyImported };
});
