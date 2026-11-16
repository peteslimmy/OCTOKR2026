import { api, fail, requirePerm } from "@/lib/api/handler";
import { listBuGoals } from "@/lib/data";
import { explaining } from "@/lib/import/history-route";
import { receiveUpload } from "@/lib/import/upload";
import { parseBuGoalUpload } from "@/lib/reports/bu-goal-upload";

const LIMITS = { maxBytes: 512 * 1024, maxRows: 300, maxColumns: 6 };

/**
 * A BU Lead adds many quarterly goals for the unit from a .csv or .xlsx (query: businessUnitId, quarterId). The file is read as data only.
 * Everything is checked first and added in one step: if any row has a problem nothing is added and the problems are listed, each with its row.
 * Locks, scope and duplicates are checked again by the database through the same function as one goal at a time.
 */
export const POST = api({}, async ({ actor, req, rpc }) => {
  requirePerm(actor, "bu_goals.manage");
  const q = new URL(req.url).searchParams;
  const businessUnitId = q.get("businessUnitId") || actor.buId;
  const quarterId = q.get("quarterId");
  if (!businessUnitId || !quarterId) throw fail("VALIDATION_ERROR", 422, "Say which unit and quarter the goals are for.");
  const parsed = await receiveUpload(req, LIMITS);
  const existing = (await listBuGoals(businessUnitId, quarterId)).filter((g) => g.status === "ACTIVE");
  const { titles, errors } = parseBuGoalUpload(parsed.headers, parsed.rows, new Set(existing.map((g) => g.title)));
  if (errors.length) {
    throw fail("VALIDATION_ERROR", 422, `The file has ${errors.length} problem${errors.length === 1 ? "" : "s"}. Nothing was added.`, errors.slice(0, 40));
  }
  return explaining("Adding the goals", () => rpc("bulk_save_bu_goals", { p_actor: actor.id, p_bu: businessUnitId, p_quarter: quarterId, p_titles: titles }));
});
