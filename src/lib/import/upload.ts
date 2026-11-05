import "server-only";
import { fail } from "@/lib/api/handler";
import { explainFileError } from "./history-explain";
import { ImportFileError, readImportFile, type ParsedFile, type ReadLimits } from "./read-file";

/**
 * Receives a spreadsheet upload for ANY bulk import and reads it as data. Every refusal carries what happened and what to do (details.problem, details.fix),
 * so no screen has to show "the file is not valid" without saying why. Used by every upload route.
 */
export async function receiveUpload(req: Request, limits: ReadLimits): Promise<ParsedFile> {
  const mb = limits.maxBytes / 1024 / 1024;
  const tooBig = `The file is larger than ${mb >= 1 ? mb : mb.toFixed(1)} MB.`;
  if (Number(req.headers.get("content-length") ?? 0) > limits.maxBytes + 64 * 1024) throw fail("IMPORT_TOO_LARGE", 413, tooBig, explainFileError(tooBig));
  let form: FormData;
  try { form = await req.formData(); } catch {
    throw fail("VALIDATION_ERROR", 422, "The upload could not be read.", { problem: "The upload did not arrive in a form the server could read (often an interrupted connection).", fix: "Choose the file again. If it repeats, save the sheet as .xlsx or .csv again and try a smaller file." });
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw fail("VALIDATION_ERROR", 422, "Choose a .csv or .xlsx file.", { problem: "No file was received.", fix: "Press Choose file, select the spreadsheet, and wait until it has finished loading." });
  if (file.size > limits.maxBytes) throw fail("IMPORT_TOO_LARGE", 413, tooBig, explainFileError(tooBig));
  try {
    return await readImportFile(file.name.slice(0, 255), new Uint8Array(await file.arrayBuffer()), limits);
  } catch (e) {
    if (e instanceof ImportFileError) throw fail("VALIDATION_ERROR", 422, e.message, explainFileError(e.message));
    throw fail("VALIDATION_ERROR", 422, "The file could not be read.", { problem: "The file could not be opened as a spreadsheet.", fix: "Open it in Excel, choose File, Save as, .xlsx (or CSV), and upload the new file.", technical: e instanceof Error ? e.message.slice(0, 200) : undefined });
  }
}
