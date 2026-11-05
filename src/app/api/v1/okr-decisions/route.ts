import { api } from "@/lib/api/handler";
import { listDecisions } from "@/lib/data/session-notes";

/** GET /api/v1/okr-decisions?bu=&quarter=&status=&from=&to= — the decisions register. */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams; const g = (k: string) => sp.get(k) || undefined;
  return listDecisions({ bu: g("bu"), quarter: g("quarter"), status: g("status"), from: g("from"), to: g("to") });
});
