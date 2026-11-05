import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { listAttachmentsOf } from "@/lib/data/session-notes";
import { uuid } from "@/lib/session-notes/schemas";
import { AllowedMimeTypeSchema, MAX_FILE_SIZE } from "@/lib/validators/evidence";
import { contentMatchesMime } from "@/lib/validators/evidence-signature";
import { adminClient } from "@/lib/supabase/admin";
import { scanUpload } from "@/lib/security/attachment-scan";

const Meta = z.object({ recordType: z.enum(["SESSION", "NOTE", "DECISION", "ACTION", "RISK"]), recordId: uuid, purpose: z.enum(["SUPPORTING", "COMPLETION_EVIDENCE"]).default("SUPPORTING") });

/** GET /api/v1/okr-sessions/{id}/attachments — the files attached anywhere in the session that the caller may see (names and types; the bytes come from /okr-attachments/{id}). */
export const GET = api({}, async ({ params }) => (await listAttachmentsOf(params.id)).map((a) => ({ id: a.id, file_name: a.file_name, mime_type: a.mime_type, size_bytes: a.size_bytes, record_type: a.record_type, record_id: a.record_id })));

/**
 * POST /api/v1/okr-sessions/{id}/attachments — multipart: file + metadata JSON { recordType, recordId, purpose }.
 * The same checks as every other evidence upload: allow-listed type, the file's own bytes must match that type, size cap, a checksum computed here, a private bucket.
 * The database records (and authorises) the attachment first; if the storage write then fails the record is withdrawn and the person is told nothing was saved.
 */
export const POST = api({}, async ({ actor, req, params, rpc }) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw fail("VALIDATION_ERROR", 422, "Send the file as multipart form data with a 'file' and a 'metadata' field."); }
  const file = form.get("file");
  const metaRaw = form.get("metadata");
  if (!(file instanceof File)) throw fail("VALIDATION_ERROR", 422, "A file is required.");
  if (typeof metaRaw !== "string") throw fail("VALIDATION_ERROR", 422, "The file's details (metadata) are required.");
  let meta;
  try { meta = Meta.parse(JSON.parse(metaRaw)); } catch { throw fail("VALIDATION_ERROR", 422, "The file's details are not valid."); }
  const mime = AllowedMimeTypeSchema.safeParse(file.type);
  if (!mime.success) throw fail("VALIDATION_ERROR", 422, "That file type is not accepted. Upload a PDF, image, Word, Excel or text file.");
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) throw fail("VALIDATION_ERROR", 422, "The file is empty or larger than 50 MiB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!contentMatchesMime(buffer, mime.data)) throw fail("VALIDATION_ERROR", 422, "The file's content does not match its type. Upload a genuine PDF, image, Word, Excel or text file.");
  // scan before anything is recorded or stored: a refused file leaves no attachment behind, only a line in the session timeline
  const verdict = await scanUpload(buffer, mime.data);
  if (!verdict.ok) {
    await rpc("record_okr_attachment_scan", { p_actor: actor.id, p_session: params.id, p_attachment: null, p_file_name: file.name, p_engine: verdict.reason === "UNAVAILABLE" ? "unavailable" : "scan", p_outcome: "REJECTED", p_detail: verdict.detail });
    if (verdict.reason === "UNAVAILABLE") throw fail("SCAN_UNAVAILABLE", 503, "The file could not be checked for malware just now, so it was not stored. Please try again shortly.");
    throw fail("MALWARE_DETECTED", 422, `This file was not accepted: ${verdict.detail}.`);
  }
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  const storagePath = `okr-sessions/${params.id}/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}-${safeName}`;

  const id = await rpc<string>("record_okr_attachment", {
    p_actor: actor.id, p_session: params.id, p_record_type: meta.recordType, p_record_id: meta.recordId, p_purpose: meta.purpose, p_name: file.name.slice(0, 255), p_mime: mime.data, p_size: buffer.length,
    p_checksum: checksum, p_path: storagePath,
  });
  await rpc("record_okr_attachment_scan", { p_actor: actor.id, p_session: params.id, p_attachment: id, p_file_name: file.name, p_engine: verdict.engine, p_outcome: "CLEAN", p_detail: null }).catch(() => undefined);
  const { error } = await adminClient().storage.from("evidence").upload(storagePath, buffer, { contentType: mime.data, upsert: false });
  if (error) {
    console.error("[okr-sessions] attachment upload failed:", error.message);
    await rpc("remove_okr_attachment", { p_actor: actor.id, p_attachment: id, p_reason: "The upload failed; nothing was stored." }).catch((e) => console.error("[okr-sessions] could not withdraw the record:", e));
    throw fail("STORAGE_ERROR", 502, "The file could not be stored. Nothing was saved; please try again.");
  }
  return { id, fileName: file.name, mimeType: mime.data, sizeBytes: buffer.length, checksum };
});
