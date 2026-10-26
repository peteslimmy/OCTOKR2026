import { api, fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";

/** A header-safe download name: no quotes, slashes, control characters or non-ASCII. */
const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "evidence";

/**
 * GET /api/v1/evidence/download?filePath=...
 * Access is decided with the caller's own session, so the row-level security policy on evidence_files (entity type and permission)
 * applies. Only after that does the service role read the bytes from the private bucket.
 */
export const GET = api({ stepUp: true }, async ({ req }) => {
  const filePath = new URL(req.url).searchParams.get("filePath");
  if (!filePath) throw fail("VALIDATION_ERROR", 422, "filePath is required.");

  const { data: fileRecord, error } = await (await userClient())
    .from("evidence_files")
    .select("id, file_name, mime_type, size_bytes")
    .eq("file_path", filePath)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[evidence] download check failed:", error);
    throw fail("STORAGE_ERROR", 500, "The file could not be checked.");
  }
  // not found and not permitted look the same, so file paths cannot be probed
  if (!fileRecord) throw fail("NOT_FOUND", 404, "Evidence file not found.");

  const { data: fileData, error: downloadError } = await adminClient().storage.from("evidence").download(filePath);
  if (downloadError || !fileData) {
    console.error("[evidence] download failed:", downloadError);
    // the record exists and the caller may see it: a missing object is "not found", anything else is a storage failure, not a missing file
    const missing = (downloadError as { status?: number; statusCode?: string | number } | null)?.status === 404 || String((downloadError as { statusCode?: string | number } | null)?.statusCode) === "404";
    throw missing ? fail("NOT_FOUND", 404, "Evidence file not found.") : fail("STORAGE_ERROR", 502, "The file could not be retrieved. Please try again.");
  }
  const buffer = Buffer.from(await fileData.arrayBuffer());

  return new Response(buffer, {
    headers: {
      "Content-Type": fileRecord.mime_type,
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="${safeName(fileRecord.file_name)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
