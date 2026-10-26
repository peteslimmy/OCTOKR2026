/**
 * `npm run db:reset` for the REAL local database. It erases everything, so it refuses unless you say so, and it backs up first.
 *
 *   npm run db:reset -- --erase-real-data
 *
 * Tests never need this: they use their own separate stack (npm run test:stack).
 */
import { spawnSync } from "node:child_process";
import { backupRealDatabase } from "./db-backup.mjs";

if (!process.argv.includes("--erase-real-data")) {
  console.error("Refusing: this erases the real local database (organisation, users, strategy, everything).\n" +
    "Tests do not need it; they run on a separate stack (npm run test:db).\n" +
    "If you really mean it: npm run db:reset -- --erase-real-data   (a backup is taken first)");
  process.exit(1);
}
const file = backupRealDatabase();
console.log("Backup written to", file);
const r = spawnSync("npx", ["supabase", "db", "reset"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
