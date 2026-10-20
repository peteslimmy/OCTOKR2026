import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

/**
 * Policies must call the permission functions as sub-selects (evaluated once per statement), never as bare calls (evaluated once per row).
 * The report read models scan thousands of rows; a bare call made a 5 ms query take 600 ms for a signed-in person (ADR-066).
 */
describe("row-level security cost", () => {
  it("no policy calls a permission function once per row", async () => {
    await withTx(async (c) => {
      const rows = await c.q<{ tablename: string; policyname: string; expr: string }>(
        "select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr from pg_policies where schemaname = 'public'");
      // a function name counts as per-row only if it is not directly inside a sub-select; auth.uid() may be printed as uid() or auth.uid()
      const bare = (e: string) => /(?<!SELECT )(auth_has_permission|auth_has_any|auth_bu|auth_can_view_bu)\(/.test(e) || /(?<!SELECT )auth\.uid\(\)/.test(e) || /(?<![A-Za-z_.]|SELECT )uid\(\)/.test(e);
      const offenders = rows.filter((r) => bare(r.expr)).map((r) => `${r.tablename}.${r.policyname}`);
      expect(offenders).toEqual([]);
      expect(rows.filter((r) => /SELECT auth_/.test(r.expr)).length).toBeGreaterThan(30);        // and the rewrite really happened
    });
  });

  it("the rewrite helper keeps the meaning of every function it touches", async () => {
    await withTx(async (c) => {
      const f = async (s: string) => (await c.q<{ r: string }>("select rls_initplan($1) r", [s]))[0].r;
      expect(await f("auth_has_permission('audit.read'::text)")).toBe("(SELECT auth_has_permission('audit.read'::text))");
      expect(await f("auth_has_any(ARRAY['a'::text, 'b'::text])")).toBe("(SELECT auth_has_any(ARRAY['a'::text, 'b'::text]))");
      expect(await f("(business_unit_id = auth_bu())")).toBe("(business_unit_id = (SELECT auth_bu()))");
      expect(await f("(requested_by = uid())")).toBe("(requested_by = (SELECT auth.uid()))");
      expect(await f("auth_can_view_bu(business_unit_id)")).toContain("business_unit_id IS NOT DISTINCT FROM (SELECT auth_bu())");
      expect(await f("auth_can_view_bu(business_unit_id)")).toContain("weekly_report.view_all");
      expect(await f("status = 'OPEN'")).toBe("status = 'OPEN'");
    });
  });

  it("auth_can_view_bu in the policies still means what the function means", async () => {
    await withTx(async (c) => {
      const fn = (await c.q<{ d: string }>("select pg_get_functiondef('auth_can_view_bu(uuid)'::regprocedure) d"))[0].d;
      expect(fn).toMatch(/auth_has_permission\('weekly_report\.view_all'\)\s+or\s+\(auth_has_permission\('weekly_report\.view_own_bu'\)\s+and\s+p_bu is not distinct from auth_bu\(\)\)/);
    });
  });
});
