import { api, fail, requirePerm } from "@/lib/api/handler";
import { activeWeeks, getWeekOverview, recentFinalWeeks } from "@/lib/data";

export const GET = api({}, async ({ actor, req }) => {
  requirePerm(actor, "presentation.view");
  const weekId = new URL(req.url).searchParams.get("weekId");
  const weeks = [...(await activeWeeks()), ...(await recentFinalWeeks(4))];
  const week = weekId ? weeks.find((w) => w.id === weekId) : weeks[0];
  if (!week) throw fail("NOT_FOUND", 404, "No reporting week available.");
  return { week, weeks, overview: await getWeekOverview(week.id) };
});
