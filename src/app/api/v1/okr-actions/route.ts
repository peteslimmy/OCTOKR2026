import { api } from "@/lib/api/handler";
import { listActions } from "@/lib/data/session-notes";

/** GET /api/v1/okr-actions?bu=&quarter=&status=&assignee=&overdue=true&from=&to= — the action items register (outstanding, overdue, blocked, completed...). */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams; const g = (k: string) => sp.get(k) || undefined;
  return listActions({ bu: g("bu"), quarter: g("quarter"), status: g("status"), assignee: g("assignee"), overdue: g("overdue") === "true", from: g("from"), to: g("to") });
});
