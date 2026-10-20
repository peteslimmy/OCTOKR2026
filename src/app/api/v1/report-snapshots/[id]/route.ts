import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/reports/sanitize";
import { api, fail } from "@/lib/api/handler";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

/** One snapshot with its stored result, plus a live re-check of its checksum so tampering would be visible. */
export const GET = api({}, async ({ actor, params }) => {
  if (!actor.permissions.has("reports.view")) throw fail("REPORT_NOT_AVAILABLE", 403, "You do not have access to this report.");
  const sb = await userClient();
  const { data, error } = await sb.from("report_snapshots").select("*").eq("id", params.id).maybeSingle();
  if (error) throw dbError(error, "snapshot");
  if (!data) throw fail("NOT_FOUND", 404, "That record was not found.");
  const r = data.result as { columns: unknown; rows: unknown; summary: unknown };
  const recomputed = createHash("sha256").update(canonicalJson({ columns: r.columns, rows: r.rows, summary: r.summary })).digest("hex");
  return { ...data, checksumVerified: recomputed === data.checksum };
});
