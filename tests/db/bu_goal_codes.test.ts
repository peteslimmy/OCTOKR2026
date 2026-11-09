import { describe, expect, it } from "vitest";
import { seedStrategy, withTx, type Ctx } from "./helpers";

/** Every Business Unit goal has a short, stable code (BG-1, BG-2 ...) per unit and quarter (ADR-120). */
async function world(c: Ctx) {
  const buA = await c.bu("CODEA"); const buB = await c.bu("CODEB");
  const root = await c.user(["SUPER_ADMIN"], buA, "root");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA"); const leadB = await c.user(["BU_LEAD"], buB, "leadB");
  const st = await seedStrategy(c, root);
  const add = (lead: string, bu: string, title: string) => c.rpc<string>("save_bu_goal", lead, null, bu, st.quarterId, title, "ACTIVE");
  const codes = async (bu: string) => (await c.q<{ code: string; title: string }>("select code, title from bu_goals where business_unit_id = $1 and quarter_id = $2 order by code", [bu, st.quarterId]));
  return { buA, buB, root, leadA, leadB, st, add, codes };
}

describe("Business Unit goal codes", () => {
  it("numbers a unit's goals BG-1, BG-2, ... in the order they were added, separately for each unit", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await w.add(w.leadA, w.buA, "Grow partner revenue");
      await w.add(w.leadA, w.buA, "Cut late reports");
      await w.add(w.leadB, w.buB, "Open two states");
      expect((await w.codes(w.buA)).map((g) => [g.code, g.title])).toEqual([["BG-1", "Grow partner revenue"], ["BG-2", "Cut late reports"]]);
      expect((await w.codes(w.buB)).map((g) => g.code)).toEqual(["BG-1"]);
    });
  });

  it("never reuses a code, even after the goal is retired, and never changes one", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const first = await w.add(w.leadA, w.buA, "First goal");
      await w.add(w.leadA, w.buA, "Second goal");
      await c.rpc("save_bu_goal", w.leadA, first, null, null, "First goal", "RETIRED");
      await w.add(w.leadA, w.buA, "Third goal");
      expect((await w.codes(w.buA)).map((g) => g.code)).toEqual(["BG-1", "BG-2", "BG-3"]);
      const renamed = await c.rpc<string>("save_bu_goal", w.leadA, first, null, null, "First goal, renamed", "RETIRED");
      expect(renamed).toBe(first);
      expect((await c.q<{ code: string }>("select code from bu_goals where id = $1", [first]))[0].code).toBe("BG-1");
      await c.expectError("VALIDATION_ERROR", () => c.q("update bu_goals set code = 'BG-9' where id = $1", [first]));
    });
  });

  it("gives every goal a code, even one inserted directly", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("insert into bu_goals (business_unit_id, quarter_id, title) values ($1, $2, 'Direct goal')", [w.buA, w.st.quarterId]);
      expect((await w.codes(w.buA)).map((g) => g.code)).toEqual(["BG-1"]);
    });
  });
});
