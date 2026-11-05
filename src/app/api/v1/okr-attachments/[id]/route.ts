import { api, fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";

/** A header-safe download name: no quotes, slashes, control characters or non-ASCII. */
const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "attachment";

/**
 * GET /api/v1/okr-attachments/{id} — download one attached file. Access is decided with the caller's own session (row-level security on the attachment table, which follows the
 * session and, for a note, the note's classification); only then does the service role read the bytes from the private bucket. Not found and not permitted look the same.
 */
export const GET = api({}, async ({ params }) => {
  const { data: row, error } = await (await userClient()).from("okr_session_attachments").select("file_name, mime_type, storage_path").eq("id", params.id).is("deleted_at", null).maybeSingle();
  if (error) throw fail("STORAGE_ERROR", 500, "The file could not be checked.");
  if (!row) throw fail("NOT_FOUND", 404, "That file was not found.");
  const { data, error: dl } = await adminClient().storage.from("evidence").download(row.storage_path);
  if (dl || !data) throw fail("STORAGE_ERROR", 502, "The file could not be retrieved. Please try again.");
  const buffer = Buffer.from(await data.arrayBuffer());
  return new Response(buffer, {
    headers: { "Content-Type": row.mime_type, "Content-Length": String(buffer.length), "Content-Disposition": `attachment; filename="${safeName(row.file_name)}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
});
