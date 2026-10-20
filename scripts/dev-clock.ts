/**
 * LOCAL DEVELOPMENT ONLY. Freezes (or releases) the database clock so time-based locks can be exercised.
 *
 *   npm run dev:clock -- 2026-10-20T18:00:00+01:00     freeze at that instant
 *   npm run dev:clock -- off                           release (back to real time)
 *
 * Works only against the local Supabase Docker database, using the database-owner role.
 */
import { execFileSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const arg = process.argv[2];
if (!arg) {
  console.error("usage: dev-clock <ISO timestamp with offset | off>");
  process.exit(1);
}
const sql = (q: string) =>
  execFileSync("docker", ["exec", "supabase_db_4core-okr", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", q], { stdio: "inherit" });

if (arg === "off") {
  sql("alter database postgres reset app.dev_clock");
  sql("alter database postgres reset app.environment");
} else {
  if (Number.isNaN(Date.parse(arg))) {
    console.error("not a valid timestamp:", arg);
    process.exit(1);
  }
  sql("alter database postgres set app.environment = 'development'");
  sql(`alter database postgres set app.dev_clock = '${arg.replace(/'/g, "")}'`);
}
// PostgREST keeps pooled connections that were opened with the old database settings: recycle it.
execFileSync("docker", ["restart", "supabase_rest_4core-okr"], { stdio: "ignore" });

/**
 * `docker restart` returns as soon as the container starts, not when the API is serving again. A request made in that gap fails with a 5xx
 * ("an invalid response was received from the upstream server"), which is what made the scheduler endpoint fail now and then right after a
 * clock change. Wait until the API has answered a real request several times in a row before returning.
 */
async function waitForApi() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { await new Promise((r) => setTimeout(r, 4000)); return; }          // no address to probe: a fixed pause is the best available
  const deadline = Date.now() + 60_000;
  let ok = 0;
  while (Date.now() < deadline && ok < 3) {
    const good = await fetch(`${url}/rest/v1/rpc/app_now`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: "{}" }).then((r) => r.status < 500, () => false);
    ok = good ? ok + 1 : 0;
    await new Promise((r) => setTimeout(r, good ? 150 : 500));
  }
  if (ok < 3) throw new Error("the API did not come back within 60 seconds after the restart");
}
waitForApi().then(
  () => console.log("Dev clock updated; API restarted and answering."),
  (e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); },
);
