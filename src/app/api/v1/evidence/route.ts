import { api, fail } from "@/lib/api/handler";
import { UploadEvidenceBodySchema, EvidenceEntityTypeSchema } from "@/lib/validators/evidence";
import { contentMatchesMime } from "@/lib/validators/evidence-signature";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/data/errors";
import { createHash, randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/evidence?entityType=VIOLATION&entityId=...
 * Lists the evidence files of one entity. The list is read with the CALLER's own session: read_evidence_files relies on the row-level
 * security policy on evidence_files, which the service role would bypass (audit: any signed-in user could list any entity's files).
 * Returns: { data: EvidenceFileResponse[] } (empty when the caller may not see them).
 */
export const GET = api({}, async ({ req }) => {
  const url = new URL(req.url);
  const type = EvidenceEntityTypeSchema.safeParse(url.searchParams.get("entityType"));
  const entityId = url.searchParams.get("entityId") ?? "";
  if (!type.success || !UUID.test(entityId)) throw fail("VALIDATION_ERROR", 422, "entityType (VIOLATION, LEDGER, REPORT or SESSION) and a valid entityId are required.");
  const { data, error } = await (await userClient()).rpc("read_evidence_files", { p_entity_type: type.data, p_entity_id: entityId });
  if (error) throw dbError(error, "read_evidence_files");
  return data;
});

/**
 * POST /api/v1/evidence
 * Multipart file upload endpoint. Expects multipart/form-data with:
 * - file: the file to upload
 * - metadata: JSON { entityType, entityId, fileName, mimeType, sizeBytes, checksum }
 *
 * Returns: { data: { id, filePath, fileName, mimeType, sizeBytes, checksum, uploadedAt } }
 */
export const POST = api(
  { stepUp: true },
  async ({ actor, req, rpc, correlationId }) => {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw fail("VALIDATION_ERROR", 422, "Send the file as multipart form data with a 'file' and a 'metadata' field.");
    }
    const file = formData.get("file");
    const metadataStr = formData.get("metadata");
    if (!(file instanceof File)) throw fail("VALIDATION_ERROR", 422, "A file is required.");
    if (typeof metadataStr !== "string" || !metadataStr) throw fail("VALIDATION_ERROR", 422, "The file's details (metadata) are required.");

    let metadata: unknown;
    try {
      metadata = JSON.parse(metadataStr);
    } catch {
      throw fail("VALIDATION_ERROR", 422, "The file's details (metadata) are not valid JSON.");
    }
    const parsed = UploadEvidenceBodySchema.safeParse(metadata);
    if (!parsed.success) {
      throw fail("VALIDATION_ERROR", 422, "Some of the file's details are not valid.", parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    }
    const body = parsed.data;

    if (file.size > 50 * 1024 * 1024) throw fail("VALIDATION_ERROR", 422, "The file exceeds the 50 MiB limit.");
    if (file.type !== body.mimeType) throw fail("VALIDATION_ERROR", 422, "The file's type does not match the type declared for it.");

    const buffer = Buffer.from(await file.arrayBuffer());

    // The type came from the browser along with the file, so check the bytes really are that type (audit finding F-008)
    if (!contentMatchesMime(buffer, body.mimeType)) {
      throw fail("VALIDATION_ERROR", 422, "The file's content does not match its type. Upload a genuine PDF, image, Word, Excel or text file.");
    }

    const checksum = createHash("sha256").update(buffer).digest("hex");
    if (checksum !== body.checksum) throw fail("VALIDATION_ERROR", 422, "The file's checksum does not match: it may have been damaged in transit. Try again.");

    // Storage path: evidence/{entityType}/{entityId}/{timestamp}-{random}-{filename}
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const randomSuffix = randomUUID().slice(0, 8);
    const safeFileName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `evidence/${body.entityType}/${body.entityId}/${timestamp}-${randomSuffix}-${safeFileName}`;

    // Record first: the database function enforces evidence.manage, so nobody without it can put a file in the private bucket.
    const result = await rpc("ops_upsert_evidence_file", {
      p_actor: actor.id,
      p_entity_type: body.entityType,
      p_entity_id: body.entityId,
      p_file_path: filePath,
      p_file_name: body.fileName,
      p_mime_type: body.mimeType,
      p_size_bytes: body.sizeBytes,
      p_checksum: checksum,
    });

    const { error: uploadError } = await adminClient(correlationId).storage
      .from("evidence")
      .upload(filePath, buffer, { contentType: body.mimeType, upsert: false });

    if (uploadError) {
      console.error("[evidence] upload failed:", uploadError);
      // no row may point at a file that is not there
      await rpc("ops_delete_evidence_file", { p_actor: actor.id, p_id: result }).catch((e) => console.error("[evidence] could not undo the record:", e));
      throw fail("STORAGE_ERROR", 502, "The file could not be stored. Nothing was saved; please try again.");
    }

    return {
      id: result,
      filePath,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      checksum,
      uploadedAt: new Date().toISOString(),
    };
  }
);
