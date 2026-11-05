import { z } from "zod";
import { api, fail, requirePerm } from "@/lib/api/handler";
import { fixFor } from "@/lib/import/explain-generic";
import { explaining } from "@/lib/import/history-route";
import { entityFor, policySchema, readBody, rowsSchemaFor } from "@/lib/import/reference";

/**
 * Step 5 of an import: re-validates every row on the server, then asks the database to apply them all in one transaction (or none).
 * Needs a recent authenticator check. Safe to retry: the same idempotency key returns the first result instead of importing twice,
 * and the same key with a different file or policy is refused.
 */
export const POST = api({ stepUp: true }, async ({ actor, req, params, rpc }) => {
  const entity = entityFor(params.entity);
  requirePerm(actor, entity.permission);
  const body = await readBody(req, z.object({
    rows: rowsSchemaFor(entity.id), policy: policySchema, idempotencyKey: z.string().min(8).max(100),
    fileName: z.string().trim().min(1).max(255), fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict());
  const { results, summary } = await entity.validate(body.rows, body.policy);
  if (!summary.canCommit) {
    const problems = results.flatMap((r) => r.issues.filter((i) => i.severity === "ERROR").map((i) => ({ row: r.row, field: i.field, code: i.code, message: i.message, fix: fixFor(i.message) }))).slice(0, 50);
    throw fail("IMPORT_INVALID", 422, "The import contains rows that are not valid. Nothing was changed.", problems);
  }
  return explaining("The import", () => rpc(entity.rpc, {
    p_actor: actor.id, p_rows: body.rows, p_policy: body.policy, p_idempotency_key: body.idempotencyKey, p_file_name: body.fileName, p_file_sha256: body.fileSha256,
  }));
});
