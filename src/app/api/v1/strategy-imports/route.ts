import { api, fail, requirePerm } from "@/lib/api/handler";
import { IMPORT_LIMITS } from "@/lib/import/employees";
import { ImportFileError, readImportFile } from "@/lib/import/read-file";
import { parseStrategyRows } from "@/lib/import/strategy";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Strategy import, step 1 (ADR-079): reads the sheet as data, checks the layout here and the quarter rules in the database, and returns every problem
 * with its spreadsheet row plus the rows themselves. Nothing is saved.
 */
export const POST = api({}, async ({ actor, req }) => {
  requirePerm(actor, "strategy.import");
  if (Number(req.headers.get("content-length") ?? 0) > IMPORT_LIMITS.maxBytes + 64 * 1024) throw fail("IMPORT_TOO_LARGE", 413, "The file is too large.");
  let form: FormData;
  try { form = await req.formData(); } catch { throw fail("VALIDATION_ERROR", 422, "Upload the file as form data."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw fail("VALIDATION_ERROR", 422, "Choose a .csv or .xlsx file.");
  let parsed;
  try { parsed = await readImportFile(file.name.slice(0, 255), new Uint8Array(await file.arrayBuffer())); }
  catch (e) { if (e instanceof ImportFileError) throw fail("VALIDATION_ERROR", 422, e.message); throw e; }
  const result = parseStrategyRows(parsed.headers, parsed.rows);
  if ("error" in result) throw fail("VALIDATION_ERROR", 422, result.error);
  let issues = result.problems;
  if (!issues.length) {
    const { data, error } = await adminClient().rpc("strategy_import_issues", { p_rows: result.rows });
    if (error) throw fail("INTERNAL_ERROR", 500, "The sheet could not be checked.");
    issues = (data as StrategyIssue[]).map((i) => ({ row: i.row, message: i.message }));
  }
  const quarters = [...new Set(result.rows.map((r) => `${r.year} Q${r.quarter}`))];
  return { fileName: parsed.fileName, sha256: parsed.sha256, rows: result.rows, quarters, issues: issues.slice(0, 200), issueCount: issues.length };
});
interface StrategyIssue { row: number; message: string }
