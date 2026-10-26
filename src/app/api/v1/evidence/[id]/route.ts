import { api, fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";

/**
 * GET /api/v1/evidence/:id
 * Redirects to a short-lived signed URL for an evidence file. Access is decided with the caller's own session, so the row-level
 * security policy on evidence_files (entity type and permission) is the single source of truth; the service role only signs the URL
 * after that lookup succeeds.
 */
export const GET = api({ stepUp: true }, async ({ params, correlationId }) => {
  const { data: evidence, error } = await (await userClient())
    .from("evidence_files")
    .select("id, file_path")
    .eq("id", params.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[evidence] access check failed:", error);
    throw fail("STORAGE_ERROR", 500, "The file could not be checked.");
  }
  // not found and not permitted look the same, so ids cannot be probed
  if (!evidence) throw fail("NOT_FOUND", 404, "Evidence file not found.");

  const { data: signed, error: signedError } = await adminClient(correlationId).storage.from("evidence").createSignedUrl(evidence.file_path, 300);
  if (signedError || !signed?.signedUrl) {
    console.error("[evidence] signed URL generation failed:", signedError);
    throw fail("STORAGE_ERROR", 500, "The download link could not be created.");
  }
  return Response.redirect(signed.signedUrl, 302);
});
