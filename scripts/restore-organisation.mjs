/**
 * LOCAL DEVELOPMENT ONLY. Puts the local database back to the organisation's real set-up in one command, after a test run
 * (`supabase db reset` + the dev seed) has replaced it with sample data:
 *
 *   RESTORE_ADMIN_PASSWORD='your password' npm run org:restore
 *
 * It resets the local database, creates the organisation and the Super Admin (peteslimmy@gmail.com by default; RESTORE_ADMIN_EMAIL /
 * RESTORE_ADMIN_FIRST / RESTORE_ADMIN_LAST override) and loads scripts/data/organisation.json. The password is read from the environment
 * only and is never stored. The Super Admin will be asked to set up an authenticator app again after a reset.
 */
import { spawnSync } from "node:child_process";

const password = process.env.RESTORE_ADMIN_PASSWORD;
if (!password) { console.error("Set RESTORE_ADMIN_PASSWORD first (the password you want for the Super Admin)."); process.exit(1); }
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1")) { console.error("Refusing: not a local database."); process.exit(1); }

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) { console.error(`Step failed: ${cmd} ${args.join(" ")}`); process.exit(r.status ?? 1); }
};

run("npx", ["supabase", "db", "reset"]);
await new Promise((r) => setTimeout(r, 25000));      // the sign-in service takes a few seconds to come back after a reset
run("npm", ["run", "bootstrap"], {
  BOOTSTRAP_ORG_NAME: "4CORE", BOOTSTRAP_ORG_CODE: "4CORE", BOOTSTRAP_BU_CODE: "ADM", BOOTSTRAP_BU_NAME: "ADMIN",
  BOOTSTRAP_ADMIN_EMAIL: process.env.RESTORE_ADMIN_EMAIL ?? "peteslimmy@gmail.com", BOOTSTRAP_ADMIN_FIRST: process.env.RESTORE_ADMIN_FIRST ?? "Pete",
  BOOTSTRAP_ADMIN_LAST: process.env.RESTORE_ADMIN_LAST ?? "Slimmy", BOOTSTRAP_ADMIN_PASSWORD: password,
});
run("npm", ["run", "org:load"]);
console.log("\nDone. Sign in with the Super Admin email and the password you gave. People get their one-time links from .local/setup-links.json.");
