/**
 * Runs the HTTP test files one at a time against a production build of the app, restarting the app between files.
 *
 * Why: the app keeps sign-in and attempt limits in memory (per account and per address), and the files sign in as the same seeded accounts.
 * Run together, they trip each other's limits and fail for reasons that have nothing to do with the code. One file per server start keeps them
 * independent. Needs a production build made FOR THE TEST STACK, a running test stack and a seeded database:
 *
 *   node scripts/test-stack.mjs run -- npm run build          build once, and again after the code or the test stack's address changes
 *   npm run test:api:serial                                   every file
 *   npm run test:api:serial -- recovery                       only files whose name contains the word
 *
 * Why the build must be made for the test stack: Next.js bakes NEXT_PUBLIC_SUPABASE_URL into the build, and the page gate (src/proxy.ts) uses that
 * baked address to check who is signed in. A build made for another database (for example your real local one) sends every page request to
 * /login even though the API works, which fails page checks for reasons that have nothing to do with the code. This script refuses to start
 * when the build and the test stack disagree.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Stops with a clear message when the production build was made for a different Supabase than the one these tests use. */
function checkBuildMatchesTestStack() {
  const want = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!want) return;                                              // not run through the test stack: nothing to compare with
  const dist = process.env.NEXT_DIST_DIR ?? ".next";
  const fix = "Rebuild it for the test stack:  node scripts/test-stack.mjs run -- npm run build";
  if (!existsSync(path.join(dist, "BUILD_ID"))) { console.error(`There is no production build in ${dist}. ${fix}`); process.exit(1); }
  const baked = (dir) => readdirSync(dir, { withFileTypes: true }).some((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? baked(p) : e.name.endsWith(".js") && readFileSync(p, "utf8").includes(`"${want}"`);
  });
  if (!baked(path.join(dist, "server"))) {
    console.error(`The build in ${dist} was not made for the test stack (${want}): its page gate would check sign-ins against another database. ${fix}`);
    process.exit(1);
  }
}

const PORT = process.env.API_PORT ?? "3000";
const BASE = `http://127.0.0.1:${PORT}`;
const only = process.argv.slice(2);
const files = readdirSync("tests/api").filter((f) => /\.test\.ts$/.test(f)).filter((f) => only.length === 0 || only.some((w) => f.includes(w))).sort();
if (files.length === 0) { console.error("no test files match"); process.exit(1); }
checkBuildMatchesTestStack();

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  const p = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  p.on("exit", (code) => resolve(code ?? 1));
});

async function startServer() {
  const server = spawn("npx", ["next", "start", "-p", PORT], { stdio: "ignore", shell: process.platform === "win32", env: { ...process.env, PORT, RATE_LIMIT_STORE: "memory", INTEGRATIONS_ALLOW_PRIVATE_HOSTS: "true", JOBS_SECRET_PREVIOUS: "previous-secret-used-only-by-the-api-tests" } });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await fetch(`${BASE}/login`).then((r) => r.status === 200, () => false)) return server;
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error("the app did not start within 90 seconds");
}
function stopServer(server) {
  return new Promise((resolve) => {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }).on("exit", () => resolve());
    else { server.kill("SIGTERM"); setTimeout(resolve, 500); }
  });
}

let failed = [];
for (const f of files) {
  const server = await startServer();
  console.log(`\n=== tests/api/${f}`);
  const code = await run("npx", ["vitest", "run", "--config", "vitest.api.config.ts", `tests/api/${f}`], { env: { ...process.env, API_BASE: BASE } });
  await stopServer(server);
  if (code !== 0) failed.push(f);
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : `\nAll ${files.length} HTTP test files passed.`);
process.exit(failed.length ? 1 : 0);
