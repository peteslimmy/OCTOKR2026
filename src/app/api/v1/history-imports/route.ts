import { api, fail, requirePerm } from "@/lib/api/handler";
import { HISTORY_LIMITS, parseHistoryRows, type HistoryRow } from "@/lib/import/history";
import { explainFileError, explainIssue, groupProblems } from "@/lib/import/history-explain";
import { explaining } from "@/lib/import/history-route";
import { ImportFileError, readImportFile } from "@/lib/import/read-file";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/data/errors";

/**
 * Historical weekly reports (ADR-077). Super Admin tier only (the reserved permission history.import).
 * GET lists recent uploads. POST reads the uploaded sheet as data, checks the layout and the units here, saves it as a STAGING batch, and returns every
 * problem found with the row, the cell, what was found and what to do about it, grouped by kind. Nothing becomes a report until it is rehearsed and then committed.
 */
// read_history_batches decides who the caller is from the caller's own session (auth.uid()), so it must be called with that session.
// Called through the service-role helper it saw nobody and refused every role, the Super Admin included.
export const GET = api({}, async ({ actor }) => {
  requirePerm(actor, "history.import");
  const { data, error } = await (await userClient()).rpc("read_history_batches");
  if (error) throw dbError(error, "history batches");
  return data;
});

export const POST = api({}, async ({ actor, req, rpc }) => {
  requirePerm(actor, "history.import");
  if (Number(req.headers.get("content-length") ?? 0) > HISTORY_LIMITS.maxBytes + 64 * 1024) {
    throw fail("IMPORT_TOO_LARGE", 413, `The file is larger than ${HISTORY_LIMITS.maxBytes / 1024 / 1024} MB.`, explainFileError(`The file is larger than ${HISTORY_LIMITS.maxBytes / 1024 / 1024} MB.`));
  }
  let form: FormData;
  try { form = await req.formData(); } catch { throw fail("VALIDATION_ERROR", 422, "The upload could not be read.", { problem: "The browser's upload did not arrive in a form the server could read (often an interrupted connection).", fix: "Choose the file again. If it repeats, save the sheet as .xlsx or .csv again and try a smaller file." }); }
  const file = form.get("file");
  if (!(file instanceof File)) throw fail("VALIDATION_ERROR", 422, "Choose a .csv or .xlsx file.", { problem: "No file was received.", fix: "Press Choose file, select the spreadsheet, and wait until it has finished loading." });
  let parsed;
  try {
    parsed = await readImportFile(file.name.slice(0, 255), new Uint8Array(await file.arrayBuffer()), HISTORY_LIMITS);
  } catch (e) {
    if (e instanceof ImportFileError) throw fail("VALIDATION_ERROR", 422, e.message, explainFileError(e.message));
    throw e;
  }
  const { data: units } = await adminClient().from("business_units").select("id, code, name");
  const unitList = (units ?? []) as { id: string; code: string; name: string }[];
  const result = parseHistoryRows(parsed.headers, parsed.rows, unitList);
  if ("error" in result) throw fail("VALIDATION_ERROR", 422, result.error, explainFileError(result.error));
  if (result.problems.length) {
    return { staged: false, fileProblems: result.problems.slice(0, 300), fileProblemCount: result.problems.length, groups: groupProblems(result.problems), unknownUnits: result.unknownUnits, rows: parsed.rows.length, fileName: parsed.fileName, goodRows: result.rows.length };
  }
  const batch = await explaining("Saving the file for checking", () => rpc<{ batch_id: string }>("history_create_batch", { p_actor: actor.id, p_file: parsed.fileName, p_sha: parsed.sha256, p_rows: result.rows.length }));
  for (let i = 0; i < result.rows.length; i += 2000) {
    await explaining("Saving the file for checking", () => rpc("history_stage_rows", { p_actor: actor.id, p_batch: batch.batch_id, p_rows: result.rows.slice(i, i + 2000) }));
  }
  const finished = await explaining("Checking the file against the application's rules", () => rpc<{ count: number; issues: { row: number; message: string }[]; rows: number }>("history_finish_staging", { p_actor: actor.id, p_batch: batch.batch_id }));
  const byRow = new Map<number, HistoryRow>(result.rows.map((r) => [r.row_no, r]));
  const issues = finished.issues.map((i) => explainIssue(i, byRow, unitList));
  return { staged: true, batchId: batch.batch_id, rows: finished.rows, issueCount: finished.count, issues, groups: groupProblems(issues), fileName: parsed.fileName };
});
