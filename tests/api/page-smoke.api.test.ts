/**
 * Page-render smoke test (audit finding F-004): every page of the application is requested as every seeded role on the BUILT app, and none
 * may answer with a server error. A shared-module mistake that crashes a page (the Units page returned 500 for a whole session before anyone
 * noticed) fails here. Pages are discovered from src/app, so a new page is covered automatically.
 *
 *   node scripts/test-stack.mjs run --reset --seed -- node scripts/run-api-tests.mjs page-smoke
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_ACCOUNTS, Session, loginAs } from "./session";

const FAKE = "11111111-1111-4111-8111-111111111111";

function discoverPages(): { route: string; url: string; dynamic: boolean }[] {
  const out: { route: string; url: string; dynamic: boolean }[] = [];
  const root = path.join(process.cwd(), "src", "app");
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "api") walk(p); continue; }
      if (e.name !== "page.tsx") continue;
      const rel = path.relative(root, path.dirname(p)).split(path.sep).filter((seg) => !/^\(.*\)$/.test(seg));   // route groups are not part of the URL
      const route = "/" + rel.join("/");
      out.push({ route, url: route.replace(/\[[^\]]+\]/g, FAKE), dynamic: /\[/.test(route) });
    }
  })(root);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}
const PAGES = discoverPages();
/** Shown to people who are not signed in. */
const PUBLIC_PAGES = ["/", "/login", "/forgot-password", "/reset-password"];

describe(`page smoke test over ${PAGES.length} pages`, () => {
  it("discovers the pages", () => {
    expect(PAGES.length).toBeGreaterThan(35);
  });

  it("the public pages render for an anonymous visitor", async () => {
    const anon = new Session();
    for (const route of PUBLIC_PAGES) {
      const page = PAGES.find((p) => p.route === route);
      expect(page, `page ${route} exists`).toBeTruthy();
      const r = await anon.request("GET", page!.url);
      expect(r.status, route).toBe(200);
    }
  });

  it("every other page sends an anonymous visitor to sign in, never an error", async () => {
    const anon = new Session();
    const bad: string[] = [];
    for (const p of PAGES) {
      if (PUBLIC_PAGES.includes(p.route) || p.route.startsWith("/auth") || p.route.startsWith("/site-image") || p.route.startsWith("/branding")) continue;
      const r = await anon.request("GET", p.url);
      if (r.status >= 500) bad.push(`${p.route} -> ${r.status}`);
      else if (r.status < 300 || r.status >= 400) bad.push(`${p.route} -> ${r.status} (expected a redirect to sign in)`);
    }
    expect(bad, "pages that did not redirect an anonymous visitor").toEqual([]);
  }, 120_000);

  it("no page returns a server error for any role (dynamic pages are asked for an unknown id: not found is fine, a crash is not)", async () => {
    const crashes: string[] = [];
    await Promise.all(Object.keys(ROLE_ACCOUNTS).map(async (email) => {
      const s = await loginAs(email);
      for (const p of PAGES) {
        const r = await s.request("GET", p.url);
        if (r.status >= 500) crashes.push(`${email} ${p.route} -> ${r.status}`);
      }
    }));
    expect(crashes, "pages that crashed").toEqual([]);
  }, 600_000);
});
