const fs = require("fs");
const S = process.argv[2];
const m = JSON.parse(fs.readFileSync("docs/audit/claude-code/artefacts/role-route-status-matrix.json", "utf8"));
const stat = JSON.parse(fs.readFileSync(S + "/authz-static.json", "utf8"));
const matrix = JSON.parse(fs.readFileSync("tests/db/fixtures/role-matrix.json", "utf8"));
const roles = m.roles; // email -> [roles]
const permsOf = (email) => new Set(roles[email].flatMap((r) => matrix[r] || []));
const byRoute = Object.fromEntries(stat.map((s) => [s.route.replace(/\[[^\]]+\]/g, "[x]"), s]));
const emails = Object.keys(roles);
const rows = [];
for (const [key, perRole] of Object.entries(m.statuses)) {
  const [route, method] = key.split(" ");
  const s = byRoute[route.replace(/\[[^\]]+\]/g, "[x]")];
  const denied = emails.filter((e) => perRole[e] === 403);
  const pass = emails.filter((e) => perRole[e] !== 403 && perRole[e] !== 401);
  const codes = [...new Set(emails.map((e) => perRole[e]))].sort().join("/");
  rows.push({ key, route, method, codes, denied: denied.length, pass: pass.length, perms: s?.perms || "", cls: s?.cls || "?" });
}
const total = rows.length;
console.log("route+method pairs swept as signed-in roles:", total);
console.log("  refused at least one role with 403:", rows.filter((r) => r.denied > 0).length);
console.log("  refused every role with 403:", rows.filter((r) => r.denied === emails.length).length);
console.log("  refused no role (any 2xx/4xx other than 403):", rows.filter((r) => r.denied === 0).length);
// Where the route states a single permission and the verb needs no body (GET), compare observed with expected
let checked = 0; const mismatch = [];
for (const r of rows) {
  if (r.method !== "GET" || !r.perms) continue;
  const need = r.perms.split("|").filter(Boolean);
  if (!need.length) continue;
  checked++;
  for (const e of emails) {
    const should = need.some((p) => permsOf(e).has(p));
    const got = m.statuses[r.key][e];
    const allowed = got !== 403 && got !== 401;
    if (should !== allowed) mismatch.push(`${r.key}  ${e} (${roles[e].join("+")}) expected ${should ? "ALLOWED" : "DENIED"} by [${need.join(",")}] but got ${got}`);
  }
}
console.log("\nGET routes with a stated permission compared against the approved role matrix:", checked, "routes;", mismatch.length, "mismatches");
for (const x of mismatch.slice(0, 60)) console.log("  " + x);
console.log("\nroutes with no 403 for any role (candidates for 'open to every signed-in person'):");
for (const r of rows.filter((r) => r.denied === 0)) console.log("  ", r.key.padEnd(62), r.codes.padEnd(12), r.cls, r.perms ? "perms=" + r.perms : "");
