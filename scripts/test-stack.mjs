/**
 * A SECOND, separate local Supabase stack for tests (own containers, own database, ports +100). Test runs reset THIS database, never the real one.
 *
 *   npm run test:stack -- start | stop | reset | status
 *   node scripts/test-stack.mjs run [--reset] [--seed] -- <command...>     run a command against the test stack
 *
 * `run` starts the stack if needed, optionally resets (and seeds) it, then runs the command with the environment pointing at the test stack
 * (OKR_TEST_STACK=1, DB_URL, NEXT_PUBLIC_SUPABASE_URL, app and API ports). The test setup files refuse to run without it (tests/guard.ts).
 *
 * The project is generated into .test-stack/ from supabase/config.toml and supabase/migrations/, so it never drifts from the real one.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
const WORK = path.join(ROOT, ".test-stack");
const OFFSET = 100;
const PROJECT = "4core-okr-test";
export const TEST_PORTS = { api: 54321 + OFFSET, db: 54322 + OFFSET };
export const MARKER = "OKR_TEST_DATABASE";
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORTS.db}/postgres`;
const APP_PORT = process.env.TEST_APP_PORT ?? "3100";
// the real stack's app runs on 3000; tests use their own app port so they can never reuse the real app
const EXCLUDE = "imgproxy,edge-runtime,vector,logflare,mailpit,realtime,storage-api,postgres-meta,studio";

function generate() {
  const src = readFileSync(path.join(ROOT, "supabase", "config.toml"), "utf8");
  let cfg = src.replace(/^project_id\s*=.*$/m, `project_id = "${PROJECT}"`);
  cfg = cfg.replace(/^(\s*)(port|shadow_port|inspector_port|smtp_port|pop3_port)(\s*=\s*)(\d+)/gm, (_m, s, k, eq, n) => `${s}${k}${eq}${Number(n) + OFFSET}`);
  const dir = path.join(WORK, "supabase");
  // everything the config can reference (migrations, email templates, seed files), but not the real project's runtime state
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(ROOT, "supabase"), dir, { recursive: true, filter: (src) => !/[\\/]\.(temp|branches)([\\/]|$)/.test(src) });
  writeFileSync(path.join(dir, "config.toml"), cfg);
}

// a relative workdir: the project path may contain spaces, which the Windows shell would split
const sb = (args) => spawnSync("npx", ["supabase", "--workdir", ".test-stack", ...args], { stdio: "inherit", shell: process.platform === "win32", cwd: ROOT });

async function reachable() {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2500 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

async function mark() {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  await c.query(`comment on database postgres is '${MARKER}'`);
  await c.end();
}

async function start() {
  generate();
  if (await reachable()) return;
  console.log("Starting the test stack (separate containers, ports", `${TEST_PORTS.api}/${TEST_PORTS.db})...`);
  const r = sb(["start", "-x", EXCLUDE]);
  if (r.status !== 0) throw new Error("could not start the test stack");
  await mark();
}

async function reset() {
  await start();
  generate();
  console.log("Resetting the TEST database (the real one is untouched)...");
  const r = sb(["db", "reset"]);
  if (r.status !== 0) throw new Error("test database reset failed");
  // the auth service restarts after a reset
  for (let i = 0; i < 60; i++) { if (await reachable()) break; await new Promise((x) => setTimeout(x, 1000)); }
  await mark();
  await new Promise((x) => setTimeout(x, 8000));
}

const testEnv = () => ({
  ...process.env,
  OKR_TEST_STACK: "1",
  NEXT_DIST_DIR: ".next-test",
  // never the real mail provider: .env.local selects Resend with a live key, which a test run must not reach
  EMAIL_TRANSPORT: "file",
  EMAIL_FILE_DIR: ".dev-mail",
  RESEND_API_KEY: "",
  DB_URL,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${TEST_PORTS.api}`,
  E2E_BASE_URL: `http://localhost:${APP_PORT}`,
  API_BASE: `http://localhost:${APP_PORT}`,
  API_PORT: APP_PORT,
  APP_BASE_URL: `http://localhost:${APP_PORT}`,
});

const exec = (cmd, args, env) => new Promise((resolve) => {
  const p = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env });
  p.on("exit", (code) => resolve(code ?? 1));
});

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "start") await start();
  else if (cmd === "stop") { generate(); process.exit(sb(["stop", "--no-backup"]).status ?? 0); }
  else if (cmd === "reset") await reset();
  else if (cmd === "status") console.log(await reachable() ? `test stack is up (database on ${TEST_PORTS.db})` : "test stack is not running");
  else if (cmd === "run") {
    const sep = rest.indexOf("--");
    const flags = sep < 0 ? [] : rest.slice(0, sep);
    const command = sep < 0 ? rest : rest.slice(sep + 1);
    if (command.length === 0) throw new Error("usage: test-stack.mjs run [--reset] [--seed] -- <command...>");
    if (flags.includes("--reset")) await reset(); else await start();
    if (flags.includes("--seed")) {
      const s = await exec("npx", ["tsx", "scripts/dev-seed.ts"], testEnv());
      if (s !== 0) throw new Error("seeding the test database failed");
    }
    process.exit(await exec(command[0], command.slice(1), testEnv()));
  } else {
    console.error("usage: test-stack.mjs start | stop | reset | status | run [--reset] [--seed] -- <command...>");
    process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
