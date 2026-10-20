import { api, fail, requirePerm } from "@/lib/api/handler";
import { listRoles } from "@/lib/data/config";
import { IMPORT_LIMITS } from "@/lib/import/employees";
import { ImportFileError, readImportFile } from "@/lib/import/read-file";
import { parseSignInSheet } from "@/lib/import/sign-ins";
import { checkSignIns } from "@/lib/import/sign-ins-server";

/** Sign-in import, step 1: reads the sheet as data and checks each person against the database. Nothing is saved. */
export const POST = api({}, async ({ actor, req }) => {
  requirePerm(actor, "users.manage");
  if (Number(req.headers.get("content-length") ?? 0) > IMPORT_LIMITS.maxBytes + 64 * 1024) throw fail("IMPORT_TOO_LARGE", 413, "The file is too large.");
  let form: FormData;
  try { form = await req.formData(); } catch { throw fail("VALIDATION_ERROR", 422, "Upload the file as form data."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw fail("VALIDATION_ERROR", 422, "Choose a .csv or .xlsx file.");
  let parsed;
  try { parsed = await readImportFile(file.name.slice(0, 255), new Uint8Array(await file.arrayBuffer())); }
  catch (e) { if (e instanceof ImportFileError) throw fail("VALIDATION_ERROR", 422, e.message); throw e; }
  const roles = (await listRoles()).map((r) => ({ code: r.code, name: r.name }));
  const result = parseSignInSheet(parsed.headers, parsed.rows, roles);
  if ("error" in result) throw fail("VALIDATION_ERROR", 422, result.error);
  const checked = await checkSignIns(result.rows, actor);
  const problems = [...result.problems, ...checked.problems].sort((a, b) => a.row - b.row);
  return { fileName: parsed.fileName, people: checked.ok, problems: problems.slice(0, 200), problemCount: problems.length };
});
