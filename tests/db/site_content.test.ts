import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function world(c: Ctx) {
  const bu = await c.bu("SITE");
  return { admin: await c.user(["ADMIN"], bu, "admin"), sa: await c.user(["SUPER_ADMIN"], bu, "sa"), hr: await c.user(["HR"], bu, "hr"), lead: await c.user(["BU_LEAD"], bu, "lead") };
}

describe("landing page and sign-in content (ADR-077)", () => {
  it("lets an Admin or Super Admin save content, bumps the version and records old and new in the audit log", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const v1 = await c.rpc<number>("set_site_content", w.admin, { hero: { headline: "One" } }, { form: { title: "Welcome" } });
      const v2 = await c.rpc<number>("set_site_content", w.sa, { hero: { headline: "Two" } }, { form: { title: "Welcome" } });
      expect(v2).toBe(v1 + 1);
      const audit = await c.q<{ old_values: { landing: { hero: { headline: string } } }; new_values: { landing: { hero: { headline: string } } } }>("select old_values, new_values from audit_logs where action = 'SITE_CONTENT_CHANGED' order by seq desc limit 1");
      expect(audit[0].old_values.landing.hero.headline).toBe("One");
      expect(audit[0].new_values.landing.hero.headline).toBe("Two");
    });
  });

  it("refuses everyone without the branding permission", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (const who of [w.hr, w.lead]) {
        await c.expectError("PERMISSION_DENIED", () => c.rpc("set_site_content", who, {}, {}));
        await c.expectError("PERMISSION_DENIED", () => c.rpc("set_site_image", who, "img-x1", "image/png", PNG));
        await c.expectError("PERMISSION_DENIED", () => c.rpc("delete_site_image", who, "img-x1"));
        await c.expectError("PERMISSION_DENIED", () => c.rpc("prune_site_images", who, []));
      }
    });
  });

  it("only takes content that is a JSON object, and stores no more than the size limit", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_site_content", w.admin, "123", {}));                       // a number is not an object
      await c.expectError("new row for relation", () => c.rpc("set_site_content", w.admin, { filler: "x".repeat(95_000) }, {}));
    });
  });

  it("stores pictures by name, bumps the version on replace, and never writes the picture into the audit log", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await c.rpc<number>("set_site_image", w.admin, "img-hero1", "image/png", PNG)).toBe(1);
      expect(await c.rpc<number>("set_site_image", w.admin, "img-hero1", "image/png", PNG)).toBe(2);
      const audit = await c.q<{ new_values: Record<string, unknown> }>("select new_values from audit_logs where action = 'SITE_IMAGE_CHANGED' order by seq desc limit 1");
      expect(audit[0].new_values).toMatchObject({ slot: "img-hero1", mime: "image/png" });
      expect(JSON.stringify(audit[0].new_values)).not.toContain(PNG);
    });
  });

  it("rejects an unsafe name, an SVG, and a forty-first picture", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_site_image", w.admin, "../x", "image/png", PNG));
      await c.expectError("new row for relation", () => c.rpc("set_site_image", w.admin, "img-svg1", "image/svg+xml", PNG));
      for (let i = 0; i < 40; i++) await c.rpc("set_site_image", w.admin, `img-fill${i}`, "image/png", PNG);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_site_image", w.admin, "img-one-too-many", "image/png", PNG));
    });
  });

  it("removes pictures the page no longer uses and keeps the rest", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (const s of ["img-keep1", "img-drop1", "img-drop2"]) await c.rpc("set_site_image", w.admin, s, "image/png", PNG);
      expect(await c.rpc<number>("prune_site_images", w.admin, ["img-keep1"])).toBe(2);
      expect((await c.q<{ slot: string }>("select slot from site_images order by slot")).map((r) => r.slot)).toEqual(["img-keep1"]);
      await c.rpc("delete_site_image", w.sa, "img-keep1");
      expect((await c.q("select 1 from site_images")).length).toBe(0);
    });
  });

  it("is readable without signing in, so the public pages can show it", async () => {
    await withTx(async (c) => {
      await c.q("set local role anon");
      expect((await c.q("select version from site_content")).length).toBe(1);
      await c.q("select slot from site_images");
      await expect(c.q("update site_content set version = 99 where id")).rejects.toThrow();
    });
  });
});
