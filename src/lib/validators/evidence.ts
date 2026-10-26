import { z } from "zod";

/** Allowed entity types for evidence attachments */
export const EvidenceEntityTypeSchema = z.enum(["VIOLATION", "LEDGER", "REPORT", "SESSION"]);

/** Allowed MIME types for uploads */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
] as const;

export const AllowedMimeTypeSchema = z.enum(ALLOWED_MIME_TYPES);

/** Maximum file size: 50 MiB (matches Supabase storage bucket limit) */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Upload body schema for POST /api/v1/evidence */
export const UploadEvidenceBodySchema = z.object({
  entityType: EvidenceEntityTypeSchema,
  entityId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: AllowedMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE),
  checksum: z.string().min(64).max(64), // sha256 hex
});

export type UploadEvidenceBody = z.infer<typeof UploadEvidenceBodySchema>;

/** Query params for GET /api/v1/evidence/:entityType/:entityId */
export const ListEvidenceQuerySchema = z.object({
  entityType: EvidenceEntityTypeSchema,
  entityId: z.string().uuid(),
});

export type ListEvidenceQuery = z.infer<typeof ListEvidenceQuerySchema>;

/** Params for GET /api/v1/evidence/:id (download) and DELETE /api/v1/evidence/:id */
export const EvidenceIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type EvidenceIdParams = z.infer<typeof EvidenceIdParamsSchema>;

/** Response shape for evidence file record */
export const EvidenceFileResponseSchema = z.object({
  id: z.string().uuid(),
  entityType: EvidenceEntityTypeSchema,
  entityId: z.string().uuid(),
  filePath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  checksum: z.string(),
  uploadedBy: z.string().uuid(),
  uploadedAt: z.string().datetime(), // ISO timestamptz
});

export type EvidenceFileResponse = z.infer<typeof EvidenceFileResponseSchema>;

/** Response shape for list of evidence files */
export const EvidenceListResponseSchema = z.array(EvidenceFileResponseSchema);

export type EvidenceListResponse = z.infer<typeof EvidenceListResponseSchema>;