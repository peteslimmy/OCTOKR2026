/**
 * Backs up the REAL local database (the one the app uses: container supabase_db_<project_id>) to .local/backups/.
 *
 *   npm run db:backup
 *
 * Restore with:  docker cp <file> supabase_db_4core-okr:/tmp/r.dump && docker exec supabase_db_4core-okr pg_restore -U postgres -d postgres --clean --if-exists /tmp/r.dump
 * (a data-only restore needs the triggers off; see docs/27). The test stack is separate and is never backed up here.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTAINER = "supabase_db_4core-okr";

export function backupRealDatabase() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(process.cwd(), ".local", "backups");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `db-${stamp}.dump`);
  const inContainer = `/tmp/okr-${stamp}.dump`;
  const run = (args) => spawnSync("docker", args, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });

  const dump = run(["exec", CONTAINER, "pg_dump", "-U", "postgres", "-Fc", "-f", inContainer, "postgres"]);
  if (dump.status !== 0) throw new Error(`backup failed (is the local database running?): ${dump.stderr || dump.stdout}`);
  const copy = run(["cp", `${CONTAINER}:${inContainer}`, file]);
  if (copy.status !== 0) throw new Error(`backup copy failed: ${copy.stderr}`);
  run(["exec", CONTAINER, "rm", "-f", inContainer]);
  if (!existsSync(file) || statSync(file).size < 10_000) throw new Error("backup looks empty; refusing to continue");
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { console.log("Backed up to", backupRealDatabase()); } catch (e) { console.error(e.message); process.exit(1); }
}
