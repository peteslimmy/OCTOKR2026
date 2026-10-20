import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/reports/sanitize";
import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { loadReport, paramsSchema } from "@/lib/reports/access";
import { runReport } from "@/lib/reports/run";

/**
 * Creates an immutable, organisation-wide snapshot of an official report: parameters, definition version, result and a SHA-256
 * checksum of that result. Needs `reports.snapshot` and organisation-wide scope, so the stored result can never exceed what any
 * later reader of it is allowed to see.
 */
export const POST = api(
  { body: z.object({ title: z.string().trim().min(1).max(160), note: z.string().trim().max(1000).nullish(), params: paramsSchema.default({}) }) },
  async ({ actor, body, params, rpc }) => {
    const def = loadReport(actor, params.id);
    if (!def.organisationWide || !actor.permissions.has("reports.snapshot") || !actor.permissions.has("weekly_report.view_all")) {
      throw fail("SNAPSHOT_SCOPE", 409, "Official snapshots are organisation-wide. This report cannot be snapshotted for your scope.");
    }
    const result = await runReport(def, body.params, actor);
    const checksum = createHash("sha256").update(canonicalJson({ columns: result.columns, rows: result.rows, summary: result.summary })).digest("hex");
    const id = await rpc<string>("create_report_snapshot", {
      p_actor: actor.id, p_report_id: def.id, p_version: result.definitionVersion, p_title: body.title, p_params: result.params, p_scope: "ORGANISATION",
      p_result: result, p_row_count: result.rows.length, p_checksum: checksum, p_note: body.note ?? null,
    });
    return { id, checksum, rows: result.rows.length };
  },
);
