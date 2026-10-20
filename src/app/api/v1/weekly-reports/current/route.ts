import { api } from "@/lib/api/handler";
import { activeWeeks, getReportView, reportIdFor } from "@/lib/data";

/** The caller's BU report for every live reporting week (null report = not started yet). */
export const GET = api({}, async ({ actor }) => {
  if (!actor.buId) return [];
  const weeks = await activeWeeks();
  return Promise.all(weeks.map(async (w) => {
    const id = await reportIdFor(actor.buId as string, w.id);
    return { week: w, report: id ? await getReportView(id) : null };
  }));
});
