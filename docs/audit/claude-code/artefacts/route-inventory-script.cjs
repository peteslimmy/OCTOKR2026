const fs = require("fs"), path = require("path");
const root = "src/app/api"; const out = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name === "route.ts") {
      const s = fs.readFileSync(p, "utf8");
      const methods = [...s.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      out.push({
        route: "/" + path.relative("src/app", path.dirname(p)).split(path.sep).join("/"),
        methods: methods.join(","),
        usesApi: /\bapi\(/.test(s), public: /public:\s*true/.test(s), stepUp: /stepUp:\s*true/.test(s),
        body: /body:\s*z\./.test(s) || /body:\s*[A-Z]\w+Schema/.test(s),
        rpcs: [...new Set([...s.matchAll(/rpc(?:<[^>]*>)?\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]))].join("|"),
        admin: /adminClient\(/.test(s), userDb: /userClient\(/.test(s), can: /\bcan\(/.test(s), raw: /new Response\(|NextResponse/.test(s),
      });
    }
  }
})(root);
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
const t = (f) => out.filter(f).length;
console.log("routes", out.length, "| not using api()", t((o) => !o.usesApi), "| public", t((o) => o.public), "| stepUp", t((o) => o.stepUp), "| with body schema", t((o) => o.body), "| adminClient", t((o) => o.admin), "| inline can()", t((o) => o.can), "| raw Response", t((o) => o.raw));
console.log("NOT api():", out.filter((o) => !o.usesApi).map((o) => o.route).join(", "));
console.log("PUBLIC:", out.filter((o) => o.public).map((o) => o.route + "[" + o.methods + "]").join(", "));
console.log("MUTATING w/o body schema and no rpc:", out.filter((o) => /POST|PUT|PATCH|DELETE/.test(o.methods) && !o.body && !o.rpcs).map((o) => o.route + "[" + o.methods + "]").join(", "));
