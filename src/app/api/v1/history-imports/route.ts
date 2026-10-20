import { api, fail, requirePerm } from "@/lib/api/handler";
import { HISTORY_LIMITS, parseHistoryRows } from "@/lib/import/history";
import { ImportFileError, readImportFile } from "@/lib/import/read-file";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Historical weekly reports (ADR-077). Super Admin tier only (the reserved permission history.import).
 * GET lists recent uploads. POST reads the uploaded sheet as data, checks the layout and the units here, saves it as a STAGING batch, and returns every
 * problem the database finds with the row it came from. Nothing becomes a report until it is rehearsed and then committed.
 */
export const GET = api({}, async ({ actor, rpc }) => {
  requirePerm(actor, "history.import");
  return rpc("read_history_batches", {});
});

export const POST = api({}, async ({ actor, req, rpc }) => {
  requirePerm(actor, "history.import");
  if (Number(req.headers.get("content-length") ?? 0) > HISTORY_LIMITS.maxBytes + 64 * 1024) throw fail("IMPORT_TOO_LARGE", 413, `The file is larger than ${HISTORY_LIMITS.maxBytes / 1024 / 1024} MB.`);
  let form: FormData;
  try { form = await req.formData(); } catch { throw fail("VALIDATION_ERROR", 422, "Upload the file as form data."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw fail("VALIDATION_ERROR", 422, "Choose a .csv or .xlsx file.");
  let parsed;
  try {
    parsed = await readImportFile(file.name.slice(0, 255), new Uint8Array(await file.arrayBuffer()), HISTORY_LIMITS);
  } catch (e) {
    if (e instanceof ImportFileError) throw fail("VALIDATION_ERROR", 422, e.message);
    throw e;
  }
  const { data: units } = await adminClient().from("business_units").select("id, code, name");
  const result = parseHistoryRows(parsed.headers, parsed.rows, (units ?? []) as { id: string; code: string; name: string }[]);
  if ("error" in result) throw fail("VALIDATION_ERROR", 422, result.error);
  if (result.problems.length) {
    return { staged: false, fileProblems: result.problems.slice(0, 200), fileProblemCount: result.problems.length, unknownUnits: result.unknownUnits, rows: parsed.rows.length };
  }
  const batch = await rpc<{ batch_id: string }>("history_create_batch", { p_actor: actor.id, p_file: parsed.fileName, p_sha: parsed.sha256, p_rows: result.rows.length });
  for (let i = 0; i < result.rows.length; i += 2000) {
    await rpc("history_stage_rows", { p_actor: actor.id, p_batch: batch.batch_id, p_rows: result.rows.slice(i, i + 2000) });
  }
  const finished = await rpc<{ count: number; issues: { row: number; message: string }[]; rows: number }>("history_finish_staging", { p_actor: actor.id, p_batch: batch.batch_id });
  return { staged: true, batchId: batch.batch_id, rows: finished.rows, issueCount: finished.count, issues: finished.issues, fileName: parsed.fileName };
});
