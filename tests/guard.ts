import pg from "pg";

/**
 * Tests reset, seed and commit data. They must never touch the real database. This guard runs before every database, HTTP, concurrency and
 * browser test and refuses unless ALL of these hold:
 *   1. the run was started through the test stack (OKR_TEST_STACK=1, set by `node scripts/test-stack.mjs run`), or the CI service is running it;
 *   2. DB_URL and the Supabase URL point at this machine, on the TEST stack's ports (54422 / 54421), not the real stack's (54322 / 54321);
 *   3. the database carries the marker the test stack puts on it after every reset.
 * In CI (CI=true) the stack is a throwaway one, so only the "local host" check applies.
 */
export const TEST_DB_PORT = 54422;
export const TEST_API_PORT = 54421;
export const MARKER = "OKR_TEST_DATABASE";

const hostIsLocal = (u: string) => { try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };
const portOf = (u: string) => { try { return Number(new URL(u).port); } catch { return NaN; } };

export async function assertTestEnvironment(): Promise<void> {
  const ci = process.env.CI === "true";
  const db = process.env.DB_URL;
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const refuse = (why: string): never => {
    throw new Error(
      `REFUSING TO RUN TESTS: ${why}\n` +
      "Tests erase and rewrite data. Run them through the test stack, which is a separate database:\n" +
      "  npm run test:db   |   npm run test:concurrency   |   npm run test:e2e   |   npm run test:api:serial\n" +
      "Your real data lives on ports 54321/54322 and is never used by tests.",
    );
  };

  if (!ci && process.env.OKR_TEST_STACK !== "1") refuse("this run was not started through the test stack (OKR_TEST_STACK is not set).");
  if (!db) return refuse("DB_URL is not set.");
  if (!hostIsLocal(db)) return refuse(`DB_URL is not a local address (${new URL(db).hostname}).`);
  if (api && !hostIsLocal(api)) return refuse("the Supabase URL is not a local address.");
  if (ci) return;

  if (portOf(db) !== TEST_DB_PORT) refuse(`DB_URL uses port ${portOf(db)}, not the test database port ${TEST_DB_PORT}.`);
  if (api && portOf(api) !== TEST_API_PORT) refuse(`the Supabase URL uses port ${portOf(api)}, not the test API port ${TEST_API_PORT}.`);

  const client = new pg.Client({ connectionString: db, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const r = await client.query("select shobj_description(oid, 'pg_database') as c from pg_database where datname = current_database()");
    if (r.rows[0]?.c !== MARKER) refuse("the database is not marked as a test database. Reset it with: npm run test:stack -- reset");
  } finally {
    await client.end().catch(() => undefined);
  }
}
