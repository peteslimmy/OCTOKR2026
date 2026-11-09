import { api, fail, requirePerm } from "@/lib/api/handler";
import { evaluateForGoal } from "@/lib/api/goals";
import { getReportView, getStrategyTree, getWeek, listBuGoals } from "@/lib/data";
import { fixFor } from "@/lib/import/explain-generic";
import { explaining } from "@/lib/import/history-route";
import { receiveUpload } from "@/lib/import/upload";
import { parseGoalUpload } from "@/lib/reports/goal-upload";

const LIMITS = { maxBytes: 1024 * 1024, maxRows: 800, maxColumns: 8 };

/**
 * A Business Unit Lead adds many goals, with their tasks, to one weekly report from a .csv or .xlsx. The file is read as data only.
 * Everything is checked first and everything is added in one step: if any row has a problem, nothing is added and the problems are listed, each with what to do.
 * The report's own rules still apply (open week, edit session, holiday, locks), because the goals are created through the same function as one by one.
 */
export const POST = api({}, async ({ actor, req, params, rpc }) => {
  requirePerm(actor, "goal.create");
  const parsed = await receiveUpload(req, LIMITS);
  const view = await getReportView(params.id);                       // read as the caller: a report they may not see is simply not found
  if (!view) throw fail("NOT_FOUND", 404, "That weekly report was not found.");
  const week = await getWeek(view.week.id);
  const tree = week ? await getStrategyTree(week.quarter_id) : null;
  const subKrByCode = new Map((tree?.key_results ?? []).flatMap((k) => k.sub_key_results.filter((s) => s.status !== "RETIRED").map((s) => [s.code.toUpperCase(), s.id] as const)));
  const activeGoals = (week ? await listBuGoals(view.business_unit.id, week.quarter_id) : []).filter((b) => b.status === "ACTIVE");
  // a unit goal is named by its code (BG-1); its full title is still accepted so files prepared the old way keep working. The code wins if a title happens to look like one.
  const buGoals = new Map<string, string>([...activeGoals.map((b) => [b.title.trim().toLowerCase(), b.id] as const), ...activeGoals.map((b) => [b.code.toLowerCase(), b.id] as const)]);

  const { goals, errors } = parseGoalUpload(parsed.headers, parsed.rows, subKrByCode, buGoals);
  if (errors.length) {
    const valid = [...subKrByCode.keys()].sort().slice(0, 12).join(", ");
    const goalCodes = activeGoals.map((b) => b.code).join(", ");
    throw fail("VALIDATION_ERROR", 422, `The file has ${errors.length} problem${errors.length === 1 ? "" : "s"}. Nothing was added.`,
      errors.slice(0, 40).map((e) => `${e} — What to do: ${/Sub-KR/i.test(e) && valid ? `use one of this quarter's Sub-KRs (${valid}) or leave it empty for a stretch goal.` : /BU goal/i.test(e) && goalCodes ? `use one of your unit's goal codes (${goalCodes}).` : fixFor(e)}`));
  }

  const payload: Record<string, unknown>[] = [];
  for (const g of goals) {
    const evaluation = await evaluateForGoal({ goalType: g.goalType, subKeyResultId: g.subKeyResultId, title: g.title, description: g.description });
    payload.push({ goal_type: g.goalType, sub_kr_id: g.subKeyResultId, bu_goal_id: g.buGoalId, title: g.title, description: g.description, tasks: g.tasks, evaluation });
  }
  return explaining("Adding the goals", () => rpc("bulk_create_goals", { p_actor: actor.id, p_report_id: params.id, p_goals: payload }));
});
