import { api, requirePerm } from "@/lib/api/handler";
import { suggestMappingFor } from "@/lib/import/entities";
import { IMPORT_LIMITS } from "@/lib/import/employees";
import { receiveUpload } from "@/lib/import/upload";
import { entityFor } from "@/lib/import/reference";

/**
 * Step 1 of an import: reads the uploaded file (as data only) and returns its columns, rows and a suggested column mapping.
 * Nothing is saved. The file's SHA-256 is returned so the commit can be tied to exactly this file. Any refusal says what happened and what to do.
 */
export const POST = api({}, async ({ actor, req, params }) => {
  const entity = entityFor(params.entity);
  requirePerm(actor, entity.permission);
  const parsed = await receiveUpload(req, IMPORT_LIMITS);
  return { fileName: parsed.fileName, sha256: parsed.sha256, kind: parsed.kind, headers: parsed.headers, rows: parsed.rows, mapping: suggestMappingFor(entity.ui.fields, parsed.headers) };
});
