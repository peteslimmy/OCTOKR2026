import { z } from "zod";
import { api } from "@/lib/api/handler";
import { UploadEvidenceBodySchema, ListEvidenceQuerySchema } from "@/lib/validators/evidence";
import { adminClient } from "@/lib/supabase/admin";
import { createHash, randomUUID } from "node:crypto";

/**
 * GET /api/v1/evidence?entityType=VIOLATION&entityId=...
 * List evidence files for an entity.
 * Returns: { data: EvidenceFileResponse[] }
 */
export const GET = api({}, async ({ req, rpc }) => {
  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (!entityType || !entityId) {
    throw new Error("VALIDATION_ERROR: entityType and entityId are required");
  }
  const result = await rpc("read_evidence_files", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  return result;
});

/**
 * POST /api/v1/evidence
 * Multipart file upload endpoint.
 * Expects multipart/form-data with fields:
 * - file: the file to upload
 * - entityType: one of VIOLATION, LEDGER, REPORT, SESSION
 * - entityId: UUID of the entity
 *
 * Returns: { data: { id, filePath, fileName, mimeType, sizeBytes, checksum, uploadedAt } }
 */
export const POST = api(
  { stepUp: true },
  async ({ actor, req, rpc, correlationId }) => {
    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const metadataStr = formData.get("metadata") as string | null;

    if (!file) {
      throw new Error("VALIDATION_ERROR: file is required");
    }
    if (!metadataStr) {
      throw new Error("VALIDATION_ERROR: metadata is required");
    }

    let metadata;
    try {
      metadata = JSON.parse(metadataStr);
    } catch {
      throw new Error("VALIDATION_ERROR: invalid metadata");
    }

    // Validate metadata against schema
    const body = UploadEvidenceBodySchema.parse(metadata);

    // Validate file size (additional check beyond schema)
    if (file.size > 50 * 1024 * 1024) {
      throw new Error("VALIDATION_ERROR: file exceeds 50 MiB limit");
    }

    // Validate MIME type matches metadata
    if (file.type !== body.mimeType) {
      throw new Error(`VALIDATION_ERROR: MIME type mismatch`);
    }

    // Read file as ArrayBuffer for checksum and upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Compute SHA256 checksum
    const checksum = createHash("sha256").update(buffer).digest("hex");

    // Verify checksum matches what client sent (integrity check)
    if (checksum !== body.checksum) {
      throw new Error("VALIDATION_ERROR: checksum mismatch");
    }

    // Generate storage path: evidence/{entityType}/{entityId}/{timestamp}-{random}-{filename}
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

    const supabase = adminClient(correlationId);
    const { error: uploadError } = await supabase.storage
      .from("evidence")
      .upload(filePath, buffer, { contentType: body.mimeType, upsert: false });

    if (uploadError) {
      console.error("[evidence] upload failed:", uploadError);
      // no row may point at a file that is not there
      await rpc("ops_delete_evidence_file", { p_actor: actor.id, p_id: result }).catch((e) => console.error("[evidence] could not undo the record:", e));
      throw new Error("STORAGE_ERROR: failed to upload file");
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