import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

// Rules that must hold for EVERY table in the public schema, present and future (audit finding F-012).
describe("database-wide security invariants", () => {
  it("every public table has row-level security enabled", async () => {
    await withTx(async (c) => {
      const open = await c.q<{ relname: string }>(
        "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1");
      expect(open.map((r) => r.relname)).toEqual([]);
    });
  });

  it("neither anonymous nor signed-in users can write to any public table", async () => {
    await withTx(async (c) => {
      const writes = await c.q<{ grantee: string; table_name: string; privilege_type: string }>(
        "select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE') order by 1,2,3");
      expect(writes).toEqual([]);
    });
  });

  it("anonymous users can call no function in the public schema", async () => {
    await withTx(async (c) => {
      const callable = await c.q<{ proname: string }>(
        "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1");
      expect(callable.map((r) => r.proname)).toEqual([]);
    });
  });

  it("every security-definer function pins its search_path", async () => {
    await withTx(async (c) => {
      const loose = await c.q<{ proname: string }>(
        "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%') order by 1");
      expect(loose.map((r) => r.proname)).toEqual([]);
    });
  });
});
