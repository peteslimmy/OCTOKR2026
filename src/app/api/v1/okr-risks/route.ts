import { api } from "@/lib/api/handler";
import { listRisks } from "@/lib/data/session-notes";

/** GET /api/v1/okr-risks?bu=&quarter=&status=&severity=&openOnly=true — the risks, blockers and issues register. */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams; const g = (k: string) => sp.get(k) || undefined;
  return listRisks({ bu: g("bu"), quarter: g("quarter"), status: g("status"), severity: g("severity"), openOnly: g("openOnly") === "true" });
});
