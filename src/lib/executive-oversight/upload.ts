import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";
import { scanUpload } from "@/lib/security/attachment-scan";
import { AllowedMimeTypeSchema, MAX_FILE_SIZE } from "@/lib/validators/evidence";
import { contentMatchesMime } from "@/lib/validators/evidence-signature";

/**
 * Attaches a file to a comment or a recommendation: the same checks as every other upload in the application (allow-listed type, the file's own bytes must match that type, size cap,
 * malware scan before anything is recorded, checksum computed here, private bucket). The database records and authorises the attachment first; if the storage write then fails the record
 * is withdrawn and the person is told nothing was saved.
 */
export async function uploadAttachment(a: {
  req: Request; rpc: <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<T>; actorId: string; commentId: string | null; recId: string | null;
}) {
  let form: FormData;
  try { form = await a.req.formData(); } catch { throw fail("VALIDATION_ERROR", 422, "Send the file as multipart form data with a 'file' field."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw fail("VALIDATION_ERROR", 422, "A file is required.");
  const mime = AllowedMimeTypeSchema.safeParse(file.type);
  if (!mime.success) throw fail("VALIDATION_ERROR", 422, "That file type is not accepted. Upload a PDF, image, Word, Excel or text file.");
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) throw fail("VALIDATION_ERROR", 422, "The file is empty or larger than 50 MiB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!contentMatchesMime(buffer, mime.data)) throw fail("VALIDATION_ERROR", 422, "The file's content does not match its type. Upload a genuine PDF, image, Word, Excel or text file.");
  const verdict = await scanUpload(buffer, mime.data);
  const recordId = a.commentId ?? a.recId ?? "";
  if (!verdict.ok) {
    await a.rpc("record_eo_attachment_scan", { p_actor: a.actorId, p_record: recordId, p_file_name: file.name, p_engine: verdict.reason === "UNAVAILABLE" ? "unavailable" : "scan", p_outcome: "REJECTED", p_detail: verdict.detail }).catch(() => undefined);
    if (verdict.reason === "UNAVAILABLE") throw fail("SCAN_UNAVAILABLE", 503, "The file could not be checked for malware just now, so it was not stored. Please try again shortly.");
    throw fail("MALWARE_DETECTED", 422, `This file was not accepted: ${verdict.detail}.`);
  }
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  const storagePath = `executive-oversight/${a.commentId ? "comments" : "recommendations"}/${recordId}/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}-${safeName}`;
  const id = await a.rpc<string>("record_eo_attachment", { p_actor: a.actorId, p_comment: a.commentId, p_rec: a.recId, p_name: file.name.slice(0, 255), p_mime: mime.data, p_size: buffer.length, p_checksum: checksum, p_path: storagePath });
  await a.rpc("record_eo_attachment_scan", { p_actor: a.actorId, p_record: id, p_file_name: file.name, p_engine: verdict.engine, p_outcome: "CLEAN", p_detail: null }).catch(() => undefined);
  const { error } = await adminClient().storage.from("evidence").upload(storagePath, buffer, { contentType: mime.data, upsert: false });
  if (error) {
    console.error("[executive-oversight] attachment upload failed:", error.message);
    await a.rpc("remove_eo_attachment", { p_actor: a.actorId, p_attachment: id, p_reason: "The upload failed; nothing was stored." }).catch((e) => console.error("[executive-oversight] could not withdraw the record:", e));
    throw fail("STORAGE_ERROR", 502, "The file could not be stored. Nothing was saved; please try again.");
  }
  return { id, fileName: file.name, mimeType: mime.data, sizeBytes: buffer.length, checksum };
}
