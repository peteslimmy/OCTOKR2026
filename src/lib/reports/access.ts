import "server-only";
import { z } from "zod";
import { fail } from "@/lib/api/handler";
import type { Actor } from "@/lib/auth/actor";
import { reportById } from "./catalogue";
import type { ReportDefinition, ReportParams } from "./types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd");
export const paramsSchema = z.object({ quarterId: z.string().uuid().optional(), buId: z.string().uuid().optional(), from: date.optional(), to: date.optional() }).strict();

/** Report parameters come from an explicit allowlist; anything else is rejected, never passed on. */
export function readParams(search: URLSearchParams): ReportParams {
  const raw: Record<string, string> = {};
  for (const k of ["quarterId", "buId", "from", "to"]) { const v = search.get(k); if (v) raw[k] = v; }
  const parsed = paramsSchema.safeParse(raw);
  if (!parsed.success) throw fail("VALIDATION_ERROR", 422, "Some of the report filters are not valid.", parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  return parsed.data;
}

/** Module access plus the report's own data permission. Row scope (BU, finance, governance) is enforced again by the database. */
export function authoriseReport(actor: Actor, def: ReportDefinition | undefined): ReportDefinition {
  if (!def) throw fail("REPORT_NOT_FOUND", 404, "That report does not exist.");
  if (!actor.permissions.has("reports.view")) throw fail("REPORT_NOT_AVAILABLE", 403, "You do not have access to this report.");
  if (def.requires.length && !def.requires.some((p) => actor.permissions.has(p))) throw fail("REPORT_NOT_AVAILABLE", 403, "You do not have access to this report.");
  return def;
}

export const loadReport = (actor: Actor, id: string) => authoriseReport(actor, reportById(id));
export const availableReports = (actor: Actor, all: ReportDefinition[]) =>
  actor.permissions.has("reports.view") ? all.filter((d) => !d.requires.length || d.requires.some((p) => actor.permissions.has(p))) : [];

export const savedBody = z.object({
  name: z.string().trim().min(1).max(120), reportId: z.string().min(1).max(60), params: paramsSchema.default({}),
  columns: z.array(z.string().max(60)).max(40).nullish(), sortBy: z.object({ key: z.string().max(60), dir: z.enum(["asc", "desc"]) }).nullish(),
  sharedWith: z.array(z.string().uuid()).max(50).default([]),
});
