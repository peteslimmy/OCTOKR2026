/**
 * Looks for credentials that must never be committed: private keys, cloud and payment keys, tokens, and long signed tokens (JWTs).
 * It reads files that would be committed (skips dependencies, build output, local environment files and test output) and exits 1 when it finds one.
 *
 *   node scripts/scan-secrets.mjs
 *
 * The throwaway keys of a local Supabase stack are published by Supabase and are written into .env.local by scripts/ci-env.sh; they are not committed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".next", ".next-test", ".test-stack", ".git", "test-results", "playwright-report", ".dev-mail", ".temp", "coverage"]);
const SKIP_FILES = new Set([".env.local", ".dev-mfa.json", "package-lock.json", "tsconfig.tsbuildinfo"]);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|sql|yml|yaml|toml|sh|env|example|txt|css|html)$/i;
const RULES = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["live payment key", /\bsk_live_[0-9a-zA-Z]{16,}\b/],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ["GitHub token", /\bgh[pousr]_[0-9A-Za-z]{30,}\b/],
  ["signed token (JWT)", /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\b/],
  ["password in a connection string", /\b(?:postgres(?:ql)?|smtps?|amqps?|mongodb(?:\+srv)?):\/\/[^\s:@/]+:(?!password@|postgres@|user:password@|\$\{)[^\s@/]{6,}@(?!127\.0\.0\.1|localhost)/],
];

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full); continue; }
    if (!TEXT.test(name) || st.size > 2_000_000) continue;
    const lines = readFileSync(full, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [what, re] of RULES) if (re.test(line)) hits.push(`${path.relative(".", full)}:${i + 1}  ${what}`);
    });
  }
}
walk(".");
if (hits.length) {
  console.error(`Possible secrets found (${hits.length}). Remove them, rotate them if they were real, and use environment variables:\n` + hits.join("\n"));
  process.exit(1);
}
console.log("No secrets found in the files that would be committed.");
