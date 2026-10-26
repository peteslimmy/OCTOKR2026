/**
 * Acceptance-criteria traceability report (audit finding F-019).
 *
 *   npm run ac:coverage                 prints which criteria in docs/20 are cited by a test and which are not
 *   npm run ac:coverage -- --out file   also writes the report as Markdown
 *
 * A test cites a criterion by putting its id (for example AC-WR-004) in the test name or a comment. "Not cited" does not prove "not tested":
 * it means nothing in the repository says which test proves the criterion, so nobody can check. Tag the tests; the list shrinks.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const doc = readFileSync("docs/20-ACCEPTANCE-CRITERIA.md", "utf8");
const criteria = new Map();
for (const m of doc.matchAll(/^#{2,4}\s+(AC-[A-Z]+-\d+)\b[^\n]*\n([^\n#]*)/gm)) criteria.set(m[1], (m[2] || "").trim().slice(0, 140));
for (const m of doc.matchAll(/\b(AC-[A-Z]+-\d+)\b/g)) if (!criteria.has(m[1])) criteria.set(m[1], "");

const cited = new Map();
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".next", ".next-test", ".test-stack", ".git", "docs"].includes(e)) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(test|spec)\.tsx?$/.test(e) && !/[\/]tests[\/]/.test(p)) continue;
    for (const m of readFileSync(p, "utf8").matchAll(/\bAC-[A-Z]+-\d+\b/g)) (cited.get(m[0]) ?? cited.set(m[0], new Set()).get(m[0])).add(p.split(path.sep).join("/"));
  }
})(".");

const ids = [...criteria.keys()].sort();
const hit = ids.filter((id) => cited.has(id));
const miss = ids.filter((id) => !cited.has(id));
const byPrefix = {};
for (const id of ids) { const k = id.replace(/-\d+$/, ""); (byPrefix[k] ??= { total: 0, cited: 0 }).total++; if (cited.has(id)) byPrefix[k].cited++; }

const lines = [];
lines.push(`# Acceptance-criteria traceability`, ``, `${hit.length} of ${ids.length} criteria are cited by at least one test (${((100 * hit.length) / Math.max(1, ids.length)).toFixed(0)}%).`, ``, `| Area | Cited | Total |`, `|---|---|---|`);
for (const [k, v] of Object.entries(byPrefix).sort()) lines.push(`| ${k} | ${v.cited} | ${v.total} |`);
lines.push(``, `## Cited`, ...hit.map((id) => `- ${id}: ${[...cited.get(id)].join(", ")}`), ``, `## Not cited by any test`, ...miss.map((id) => `- ${id}${criteria.get(id) ? ": " + criteria.get(id) : ""}`), ``);
const text = lines.join("\n");
const out = process.argv.indexOf("--out");
if (out > 0) writeFileSync(process.argv[out + 1], text);
console.log(lines.slice(0, 4 + Object.keys(byPrefix).length + 2).join("\n"));
console.log(`\n${miss.length} not cited${out > 0 ? " (full list written to " + process.argv[out + 1] + ")" : " (run with --out <file> for the full list)"}`);
