import { W1, draftGoal, evalJson, seedStrategy, weekId, type Ctx } from "./helpers";

/**
 * Shared by the end-to-end journey and security tests: unit ALPHA sets the same three goals in weeks 1 to 3 of 2031 and finishes none; BRAVO files and finishes its goal each week;
 * CHARLIE files nothing. Weeks 1 to 3 are finalised and 4COREPAL is on. "Now" is the end of week 3.
 */
const GOALS = ["Publish the pricing sheets by Friday", "Run one customer interview by Thursday", "Send the onboarding guide to finance"];
export async function aiWorld(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA"), buB = await c.bu("BRAVO"), buC = await c.bu("CHARLIE");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa"), sa2 = await c.user(["SUPER_ADMIN"], buA, "sa2"), admin = await c.user(["ADMIN"], buA, "admin"), exec = await c.user(["EXECUTIVE"], buA, "exec");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA"), leadA2 = await c.user(["BU_LEAD"], buA, "leadA2"), leadB = await c.user(["BU_LEAD"], buB, "leadB"), leadC = await c.user(["BU_LEAD"], buC, "leadC");
  const strat = await seedStrategy(c, admin);
  const weeks = [["2031-01-06", W1.open, W1.afterContentLock, W1.finalLock], ["2031-01-13", "2031-01-13T09:00:00+01:00", "2031-01-14T18:00:01+01:00", "2031-01-21T11:00:00+01:00"], ["2031-01-20", "2031-01-20T09:00:00+01:00", "2031-01-21T18:00:01+01:00", "2031-01-28T11:00:00+01:00"]];
  const ids: string[] = [];
  for (const [monday, open, locked, final] of weeks) {
    const wk = await weekId(c, monday); ids.push(wk);
    await c.setNow(open);
    const a = await draftGoal(c, leadA, wk, strat.subKrIds[0], ["Do the first part", "Do the second part"], GOALS[0]);
    let v = a.version;
    for (const t of GOALS.slice(1)) v = (await c.rpc<{ version: number }>("create_goal", leadA, a.reportId, "STRETCH", null, t, null, [{ description: "Do the work" }], evalJson, v)).version;
    const b = await draftGoal(c, leadB, wk, strat.subKrIds[1], ["Close the BRAVO proposal"], "Close two open proposals by Friday");
    await c.rpc("submit_weekly_report", leadA, a.reportId, null, null); await c.rpc("submit_weekly_report", leadB, b.reportId, null, null);
    await c.setNow(locked);
    const tasks = await c.q<{ id: string; bu: string }>("select t.id, t.business_unit_id bu from tasks t join smart_goals g on g.id = t.smart_goal_id join weekly_reports r on r.id = g.weekly_report_id where r.reporting_week_id = $1", [wk]);
    for (const t of tasks) await c.rpc("execute_task", t.bu === buB ? leadB : leadA, t.id, t.bu === buB ? "DONE" : "NOT_DONE");
    await c.setNow(final); await c.rpc("finalize_reporting_week", wk);
  }
  await c.rpc("ai_set_setting", sa, "enabled", true);
  return { buA, buB, buC, sa, sa2, admin, exec, leadA, leadA2, leadB, leadC, weeks: ids };
}
