/**
 * BACKUP AND RESTORE DRILL (local Supabase Docker database). Proves a backup can be restored and that what comes back is the same data:
 *   1. takes a full custom-format dump of the database,
 *   2. restores it into a brand-new scratch database,
 *   3. compares every table's row count with the original,
 *   4. re-checks the rules that must survive a restore: the fund reconciles, the append-only triggers are still there, every function came back,
 *   5. drops the scratch database and the dump, and prints a report with timings.
 *
 *   npm run drill:restore
 *
 * It reads the live database and writes only to a scratch database it creates and removes. For a real environment the same steps apply with
 * the provider's own backup tool in step 1 (see docs/27-DEPLOYMENT-AND-OPERATIONS.md); this script is the repeatable local rehearsal.
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const CONTAINER = "supabase_db_4core-okr";
const SCRATCH = "okr_restore_drill";
const SRC = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const scratchUrl = SRC.replace(/\/[^/?]+(\?.*)?$/, `/${SCRATCH}`);

const docker = (...args: string[]) => execFileSync("docker", ["exec", CONTAINER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const psql = (db: string, sql: string) => docker("psql", "-U", "supabase_admin", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql);
const ms = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)} s`;

async function counts(url: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const tables = (await c.query("select tablename from pg_tables where schemaname = 'public' order by tablename")).rows.map((r) => r.tablename as string);
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = Number((await c.query(`select count(*) n from public."${t}"`)).rows[0].n);
    const functions = Number((await c.query("select count(*) n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")).rows[0].n);
    const guards = (await c.query("select tgname from pg_trigger where not tgisinternal and tgname in ('audit_logs_immutable','ledger_immutable','ledger_balance_guard','import_batches_immutable','strategy_item_versions_immutable') order by tgname")).rows.map((r) => r.tgname as string);
    const fund = (await c.query(`select coalesce(sum(case entry_type when 'CREDIT' then amount else -amount end), 0)::text as balance,
        coalesce(sum(amount) filter (where entry_type = 'CREDIT' and source_type <> 'REVERSAL'), 0)::text as credits,
        coalesce(sum(amount) filter (where entry_type = 'DEBIT' and source_type <> 'REVERSAL'), 0)::text as debits from financial_ledger_entries`)).rows[0];
    const pay = (await c.query("select coalesce(sum(amount), 0)::text as v from violation_payments")).rows[0].v as string;
    const dis = (await c.query("select coalesce(sum(amount), 0)::text as v from disbursements")).rows[0].v as string;
    const audit = (await c.query("select count(*)::int n, coalesce(max(seq), 0)::text as last from audit_logs")).rows[0];
    return { tables: out, functions, guards, fund, pay, dis, audit };
  } finally { await c.end(); }
}

async function main() {
  const report: string[] = [];
  const problems: string[] = [];
  let t = Date.now();
  docker("sh", "-c", "pg_dump -U supabase_admin -d postgres -Fc -f /tmp/okr-drill.dump");
  const size = Number(docker("sh", "-c", "stat -c %s /tmp/okr-drill.dump").trim());
  report.push(`1. Backup: ${(size / 1024).toFixed(0)} KB in ${ms(t)}`);

  try {
    psql("postgres", `drop database if exists ${SCRATCH}`);
    psql("postgres", `create database ${SCRATCH}`);
    t = Date.now();
    docker("sh", "-c", `pg_restore -U supabase_admin -d ${SCRATCH} --no-owner --exit-on-error /tmp/okr-drill.dump`);
    report.push(`2. Restore into a new database: ${ms(t)}`);

    const [a, b] = [await counts(SRC), await counts(scratchUrl)];
    const names = Object.keys(a.tables);
    const mismatched = names.filter((n) => a.tables[n] !== b.tables[n]);
    const missing = names.filter((n) => !(n in b.tables));
    report.push(`3. Row counts: ${names.length} tables compared, ${names.length - mismatched.length - missing.length} identical, ${mismatched.length} different, ${missing.length} missing`);
    for (const n of mismatched) problems.push(`table ${n}: original ${a.tables[n]}, restored ${b.tables[n]}`);
    for (const n of missing) problems.push(`table ${n} did not come back`);

    if (a.functions !== b.functions) problems.push(`functions: original ${a.functions}, restored ${b.functions}`);
    report.push(`4. Functions: ${a.functions} original, ${b.functions} restored`);
    if (JSON.stringify(a.guards) !== JSON.stringify(b.guards)) problems.push(`protective triggers differ: ${a.guards.join(",")} versus ${b.guards.join(",")}`);
    report.push(`   Protective triggers present after restore: ${b.guards.length} of ${a.guards.length}`);
    const reconciles = Number(b.fund.credits) === Number(b.pay) && Number(b.fund.debits) === Number(b.dis) && Number(b.fund.balance) >= 0 && b.fund.balance === a.fund.balance;
    if (!reconciles) problems.push(`the restored fund does not reconcile or differs: ${JSON.stringify(b.fund)} against payments ${b.pay}, disbursements ${b.dis}`);
    report.push(`   Fund after restore: balance ${b.fund.balance}, credits ${b.fund.credits} = payments ${b.pay}, debits ${b.fund.debits} = disbursements ${b.dis}: ${reconciles ? "reconciles" : "DOES NOT RECONCILE"}`);
    if (a.audit.n !== b.audit.n || a.audit.last !== b.audit.last) problems.push(`audit log differs: ${a.audit.n}/${a.audit.last} versus ${b.audit.n}/${b.audit.last}`);
    report.push(`   Audit log: ${a.audit.n} entries original, ${b.audit.n} restored (last sequence ${b.audit.last})`);

    // the restored copy must still refuse edits to append-only history
    const c = new Client({ connectionString: scratchUrl });
    await c.connect();
    try {
      let refused = false;
      try { await c.query("update audit_logs set action = 'TAMPERED' where seq = (select max(seq) from audit_logs)"); } catch { refused = true; }
      if (!refused && a.audit.n > 0) problems.push("the restored audit log accepted an edit");
      report.push(`   Edit to the restored audit log: ${refused || a.audit.n === 0 ? "refused" : "ACCEPTED"}`);
    } finally { await c.end(); }
  } finally {
    try { psql("postgres", `drop database if exists ${SCRATCH}`); } catch { /* best effort */ }
    try { docker("rm", "-f", "/tmp/okr-drill.dump"); } catch { /* best effort */ }
  }
  report.push(`5. Scratch database and dump removed`);
  console.log(report.join("\n"));
  if (problems.length) { console.error("\nDRILL FAILED:\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("\nDRILL PASSED: the backup restored completely and the restored data satisfies the same rules.");
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
