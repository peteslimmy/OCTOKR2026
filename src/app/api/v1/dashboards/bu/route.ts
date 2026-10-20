import { api, fail } from "@/lib/api/handler";
import { activeWeeks, currentQuarter, getReportView, latestQuarterSnapshot, recentSnapshots, reportIdFor } from "@/lib/data";

export const GET = api({}, async ({ actor }) => {
  if (!actor.buId) throw fail("BU_SCOPE_DENIED", 403, "Your account has no Business Unit.");
  const [weeks, q] = await Promise.all([activeWeeks(), currentQuarter()]);
  const current = await Promise.all(weeks.map(async (w) => {
    const id = await reportIdFor(actor.buId as string, w.id);
    return { week: w, report: id ? await getReportView(id) : null };
  }));
  return { current, recent: await recentSnapshots(actor.buId), quarter: q ? { quarter: q, score: await latestQuarterSnapshot(q.id, actor.buId) } : null };
});
