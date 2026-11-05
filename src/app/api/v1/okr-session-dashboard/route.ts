import { api } from "@/lib/api/handler";
import { getDashboard } from "@/lib/data/session-notes";

/** GET /api/v1/okr-session-dashboard?quarter=&bu=&from=&to= — counts from the records the caller may read (never hard-coded or estimated). */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams; const g = (k: string) => sp.get(k) || undefined;
  return getDashboard({ quarter: g("quarter"), bu: g("bu"), from: g("from"), to: g("to") });
});
