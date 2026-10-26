const fs = require("fs"), path = require("path");
const S = process.argv[2];
const fns = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(S, "functions.json"), "utf8")).map((f) => [f.name, f]));
const out = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "route.ts") {
      const s = fs.readFileSync(p, "utf8");
      const route = "/" + path.relative("src/app", path.dirname(p)).split(path.sep).join("/");
      const methods = [...s.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]).join(",");
      const rpcs = [...new Set([...s.matchAll(/rpc(?:<[^>]*>)?\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]))];
      const sbRpcs = [...new Set([...s.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]))].filter((n) => !rpcs.includes(n));
      const inline = /requirePerm\(|permissions\.has\(|\bcan\(|\bcanAny\(/.test(s);
      const userDb = /userClient\(/.test(s);
      const dataLayer = /from "@\/lib\/(data|reports|analytics)/.test(s) || /from "@\/lib\/data/.test(s);
      const admin = /adminClient\(/.test(s);
      const pub = /public:\s*true/.test(s);
      const partial = /partial:\s*true/.test(s);
      const badActor = [...s.matchAll(/p_actor:\s*([^,}\n]+)/g)].map((m) => m[1].trim()).filter((v) => v !== "actor.id");
      const checked = rpcs.filter((n) => fns[n]?.check), perm = rpcs.filter((n) => fns[n]?.perms.length), unknown = rpcs.filter((n) => !fns[n]);
      const unchecked = rpcs.filter((n) => fns[n] && !fns[n].check);
      let cls;
      if (pub) cls = "PUBLIC";
      else if (inline || perm.length) cls = "PERMISSION";
      else if (checked.length || userDb || dataLayer || sbRpcs.length) cls = "SCOPED(identity/RLS)";
      else if (rpcs.length && !unchecked.length) cls = "SCOPED(identity/RLS)";
      else if (!rpcs.length && !userDb && !dataLayer && !inline) cls = "NO-VISIBLE-CHECK";
      else cls = "RPC-UNCHECKED";
      out.push({ route, methods, cls, rpcs: rpcs.join("|"), perms: [...new Set(rpcs.flatMap((n) => fns[n]?.perms || []))].join("|"), inline, userDb, dataLayer, admin, partial, badActor: badActor.join("|"), unknown: unknown.join("|"), unchecked: unchecked.join("|") });
    }
  }
})("src/app/api");
fs.writeFileSync(path.join(S, "authz-static.json"), JSON.stringify(out, null, 1));
const by = {}; for (const o of out) (by[o.cls] = by[o.cls] || []).push(o);
console.log(Object.entries(by).map(([k, v]) => k + ": " + v.length).join("   "));
for (const k of ["NO-VISIBLE-CHECK", "RPC-UNCHECKED"]) { console.log("\n== " + k); for (const o of by[k] || []) console.log(" ", o.route, "[" + o.methods + "]", "rpcs=" + o.rpcs, "unchecked=" + o.unchecked, "admin=" + o.admin); }
console.log("\n== routes passing p_actor from something other than actor.id");
for (const o of out.filter((x) => x.badActor)) console.log(" ", o.route, "->", o.badActor);
console.log("\n== rpc names not found in the database");
for (const o of out.filter((x) => x.unknown)) console.log(" ", o.route, "->", o.unknown);
console.log("\n== routes whose only guard is the legit 'partial' MFA exemption");
for (const o of out.filter((x) => x.partial)) console.log(" ", o.route, "[" + o.methods + "]", o.cls);
console.log("\n== SCOPED routes using adminClient directly (check these by hand)");
for (const o of out.filter((x) => x.admin && x.cls.startsWith("SCOPED"))) console.log(" ", o.route, "[" + o.methods + "]", "rpcs=" + o.rpcs);
