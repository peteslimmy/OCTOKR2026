/**
 * Re-computes the audit hash chain of a database and exits non-zero if it is broken (ADR-109).
 *
 *   DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/audit-chain-verify.mjs
 *
 * Read-only: it calls audit_verify_chain() and writes nothing. Run it after every restore (docs/42 section 7) and on a schedule.
 */
import pg from "pg";

const url = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query("select audit_verify_chain(1) as r, (select legacy_rows from audit_chain_meta) as legacy");
  const { r, legacy } = rows[0];
  console.log(JSON.stringify({ ...r, unchained_history: Number(legacy) }, null, 2));
  process.exitCode = r.ok ? 0 : 2;
} finally {
  await client.end();
}
