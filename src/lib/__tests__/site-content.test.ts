import { describe, expect, it } from "vitest";
import { DEFAULT_LANDING, DEFAULT_LOGIN, landingSchema, loginSchema, referencedSlots, resolveSite, siteSchema } from "@/lib/site-content";

describe("landing and sign-in content", () => {
  it("the built-in content is itself valid", () => {
    expect(siteSchema.safeParse({ landing: DEFAULT_LANDING, login: DEFAULT_LOGIN }).success).toBe(true);
  });

  it("nothing stored means the built-in content", () => {
    expect(resolveSite(null)).toEqual({ landing: DEFAULT_LANDING, login: DEFAULT_LOGIN });
    expect(resolveSite({ landing: {}, login: {} })).toEqual({ landing: DEFAULT_LANDING, login: DEFAULT_LOGIN });
  });

  it("a partial change keeps every other default", () => {
    const out = resolveSite({ landing: { hero: { headline: "A new headline" } }, login: { form: { title: "Welcome back" } } });
    expect(out.landing.hero.headline).toBe("A new headline");
    expect(out.landing.hero.layout).toBe(DEFAULT_LANDING.hero.layout);
    expect(out.landing.sections).toHaveLength(DEFAULT_LANDING.sections.length);
    expect(out.login.form.title).toBe("Welcome back");
    expect(out.login.form.showForgot).toBe(true);
  });

  it("stored content that no longer fits falls back to the default for that page, not a broken page", () => {
    const out = resolveSite({ landing: { hero: { layout: "sideways" } }, login: { layout: "centered" } });
    expect(out.landing).toEqual(DEFAULT_LANDING);
    expect(out.login.layout).toBe("centered");
  });

  it("refuses links that could run script or leave through a protocol-relative address", () => {
    const withHref = (href: string) => landingSchema.safeParse({ ...DEFAULT_LANDING, hero: { ...DEFAULT_LANDING.hero, primary: { label: "Go", href } } }).success;
    for (const ok of ["/login", "#features", "https://example.com/a", "mailto:hello@example.com", ""]) expect(withHref(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "//evil.example.com", "data:text/html,x", "http://insecure.example.com", "vbscript:x"]) expect(withHref(bad), bad).toBe(false);
  });

  it("limits sizes and counts, and image names to safe characters", () => {
    expect(landingSchema.safeParse({ ...DEFAULT_LANDING, hero: { ...DEFAULT_LANDING.hero, headline: "x".repeat(161) } }).success).toBe(false);
    expect(landingSchema.safeParse({ ...DEFAULT_LANDING, sections: Array.from({ length: 13 }, () => DEFAULT_LANDING.sections[0]) }).success).toBe(false);
    expect(landingSchema.safeParse({ ...DEFAULT_LANDING, hero: { ...DEFAULT_LANDING.hero, imageSlot: "../etc/passwd" } }).success).toBe(false);
    expect(landingSchema.safeParse({ ...DEFAULT_LANDING, hero: { ...DEFAULT_LANDING.hero, imageSlot: "img-ok1" } }).success).toBe(true);
    expect(loginSchema.safeParse({ ...DEFAULT_LOGIN, panel: { ...DEFAULT_LOGIN.panel, overlay: 120 } }).success).toBe(false);
  });

  it("lists every picture the page uses, so unused uploads can be removed", () => {
    const site = resolveSite({
      landing: { hero: { imageSlot: "img-hero" }, sections: [{ ...DEFAULT_LANDING.sections[3], enabled: true, items: [{ imageSlot: "img-a" }, { imageSlot: "img-b" }] }] },
      login: { panel: { imageSlot: "img-login" } },
    });
    expect(referencedSlots(site).sort()).toEqual(["img-a", "img-b", "img-hero", "img-login"]);
  });
});
