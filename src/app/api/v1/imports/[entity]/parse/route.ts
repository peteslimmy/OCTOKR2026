import { api, fail, requirePerm } from "@/lib/api/handler";
import { suggestMappingFor } from "@/lib/import/entities";
import { IMPORT_LIMITS } from "@/lib/import/employees";
import { ImportFileError, readImportFile } from "@/lib/import/read-file";
import { entityFor } from "@/lib/import/reference";

/**
 * Step 1 of an import: reads the uploaded file (as data only) and returns its columns, rows and a suggested column mapping.
 * Nothing is saved. The file's SHA-256 is returned so the commit can be tied to exactly this file.
 */
export const POST = api({}, async ({ actor, req, params }) => {
  const entity = entityFor(params.entity);
  requirePerm(actor, entity.permission);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > IMPORT_LIMITS.maxBytes + 64 * 1024) throw fail("IMPORT_TOO_LARGE", 413, `The file is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.`);
  let form: FormData;
  try { form = await req.formData(); } catch { throw fail("VALIDATION_ERROR", 422, "Upload the file as form data."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw fail("VALIDATION_ERROR", 422, "Choose a .csv or .xlsx file.");
  if (file.size > IMPORT_LIMITS.maxBytes) throw fail("IMPORT_TOO_LARGE", 413, `The file is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.`);
  try {
    const parsed = await readImportFile(file.name.slice(0, 255), new Uint8Array(await file.arrayBuffer()));
    return { fileName: parsed.fileName, sha256: parsed.sha256, kind: parsed.kind, headers: parsed.headers, rows: parsed.rows, mapping: suggestMappingFor(entity.ui.fields, parsed.headers) };
  } catch (e) {
    if (e instanceof ImportFileError) throw fail("VALIDATION_ERROR", 422, e.message);
    throw e;
  }
});
