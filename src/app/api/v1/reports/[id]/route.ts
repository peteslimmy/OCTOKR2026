import { api } from "@/lib/api/handler";
import { loadReport, readParams } from "@/lib/reports/access";
import { runReport } from "@/lib/reports/run";

/** Runs one approved report under the caller's own permissions and row-level security. Parameters are an explicit allowlist. */
export const GET = api({}, async ({ actor, params, req }) => {
  const def = loadReport(actor, params.id);
  return runReport(def, readParams(new URL(req.url).searchParams), actor);
});
