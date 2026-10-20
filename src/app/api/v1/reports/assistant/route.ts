import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { ASSISTANT_VERSION, routeQuestion } from "@/lib/reports/assistant";
import { availableReports } from "@/lib/reports/access";
import { REPORTS, reportById } from "@/lib/reports/catalogue";
import { listQuarters } from "@/lib/data";

/**
 * Maps a question to an approved report. No model, no generated SQL: the answer is the report, opened with the asker's own
 * permissions. A question that needs data the application does not hold is answered with exactly that.
 */
export const POST = api({ body: z.object({ question: z.string().trim().min(1).max(500) }) }, async ({ actor, body }) => {
  if (!actor.permissions.has("reports.view")) throw fail("REPORT_NOT_AVAILABLE", 403, "You do not have access to this report.");
  const a = routeQuestion(body.question);
  let reportId = a.reportId;
  let answer = a.answer;
  if (reportId && !availableReports(actor, REPORTS).some((r) => r.id === reportId)) {
    answer = `That question maps to “${reportById(reportId)?.title}”, which is not available to your role.`;
    reportId = null;
  }
  let quarterId: string | null = null;
  if (reportId && a.quarterOffset === -1) {
    const qs = await listQuarters();   // newest first
    const cur = qs.findIndex((q) => q.status === "ACTIVE");
    quarterId = qs[(cur >= 0 ? cur : 0) + 1]?.id ?? null;
  }
  return { ...a, reportId, answer, quarterId, version: ASSISTANT_VERSION, model: null };
});
