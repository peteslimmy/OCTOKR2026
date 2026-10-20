import { z } from "zod";

/**
 * Everything an administrator can change about the public landing page and the sign-in screens (ADR-076).
 * The saved value is plain data: text, choices from fixed lists, and the names of uploaded images. No HTML, script or style is ever stored,
 * so a content change can never inject code. Links are limited to this site, a page anchor, https and mailto.
 */

export const ICON_NAMES = [
  "target", "calendar", "clipboard", "shield", "wallet", "chart", "lock", "users", "rocket", "zap", "globe", "layers", "trend", "bell", "file", "check", "clock", "star", "heart", "building", "award", "lightbulb", "settings", "sparkles",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

const text = (max: number) => z.string().trim().max(max);
const href = z.string().trim().max(300).refine((v) => v === "" || /^(\/(?!\/)|#|https:\/\/|mailto:)/.test(v), "Use a page of this site (/…), an anchor (#…), https://… or mailto:…");
const slot = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).nullable();
const link = z.object({ label: text(60), href });

export const SECTION_TYPES = ["features", "steps", "stats", "gallery", "quote", "trust", "cta", "text"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

const item = z.object({
  icon: z.enum(ICON_NAMES).optional(), title: text(120).optional(), text: text(600).optional(), value: text(24).optional(), label: text(80).optional(),
  imageSlot: slot.optional(), alt: text(200).optional(), caption: text(160).optional(), author: text(80).optional(), role: text(80).optional(),
});
export type SiteItem = z.infer<typeof item>;

const section = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/),
  type: z.enum(SECTION_TYPES), enabled: z.boolean(),
  title: text(120), intro: text(400), background: z.enum(["white", "surface", "brand"]), columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  button: link.nullable(), imageSlot: slot, items: z.array(item).max(12),
});
export type SiteSection = z.infer<typeof section>;

export const landingSchema = z.object({
  header: z.object({ showNav: z.boolean(), links: z.array(link).max(5), signInLabel: text(40), sticky: z.boolean() }),
  hero: z.object({
    layout: z.enum(["split", "centered", "background"]), tone: z.enum(["brand", "dark", "light"]), align: z.enum(["left", "center"]), size: z.enum(["md", "lg", "xl"]),
    eyebrow: text(80), headline: text(160), subheadline: text(400),
    primary: link, secondary: link.extend({ show: z.boolean() }),
    visual: z.enum(["illustration", "image", "3d", "none"]), imageSlot: slot, imageAlt: text(200), overlay: z.number().int().min(0).max(90),
    showCalendarCard: z.boolean(),
  }),
  sections: z.array(section).max(12),
  footer: z.object({ text: text(200), links: z.array(link).max(6), showSignIn: z.boolean() }),
});
export type LandingConfig = z.infer<typeof landingSchema>;

export const loginSchema = z.object({
  layout: z.enum(["split-left", "split-right", "centered", "background"]),
  panel: z.object({
    tone: z.enum(["brand", "dark", "light"]), headline: text(200), points: z.array(z.object({ icon: z.enum(ICON_NAMES), text: text(200) })).max(5), footerText: text(160),
    showLogo: z.boolean(), imageSlot: slot, imageAlt: text(200), overlay: z.number().int().min(0).max(90), showImage: z.boolean(), showArt: z.boolean(),
  }),
  form: z.object({ title: text(80), subtitle: text(240), footnote: text(400), showForgot: z.boolean(), forgotLabel: text(60), showBackLink: z.boolean(), backLabel: text(60) }),
});
export type LoginConfig = z.infer<typeof loginSchema>;

export const siteSchema = z.object({ landing: landingSchema, login: loginSchema });
export type SiteConfig = z.infer<typeof siteSchema>;

// ---------------------------------------------------------------- defaults (the page as it reads before anyone customises it)
const f = (icon: IconName, title: string, t: string): SiteItem => ({ icon, title, text: t });

export const DEFAULT_LANDING: LandingConfig = {
  header: { showNav: true, sticky: true, signInLabel: "Sign in", links: [{ label: "Features", href: "#features" }, { label: "How it works", href: "#how-it-works" }, { label: "Security", href: "#trust" }] },
  hero: {
    layout: "split", tone: "brand", align: "left", size: "lg",
    eyebrow: "4CORE INTEGRATED SERVICES", headline: "Turn objectives into weekly work, and weekly work into results.",
    subheadline: "One place where each Business Unit plans its week, is scored by written rules, and answers to the same record as everyone else.",
    primary: { label: "Sign in to your workspace", href: "/login" }, secondary: { label: "See how a week works", href: "#how-it-works", show: true },
    visual: "illustration", imageSlot: null, imageAlt: "", overlay: 55, showCalendarCard: false,
  },
  sections: [
    {
      id: "features", type: "features", enabled: true, title: "What the platform covers", intro: "From the annual theme to the ledger, every step follows written rules.", background: "white", columns: 3, button: null, imageSlot: null,
      items: [
        f("target", "Objectives to weekly goals", "Annual themes break into quarterly objectives, key results and Sub-KRs. Each weekly SMART goal can point to the Sub-KR it serves."),
        f("calendar", "A fixed weekly rhythm", "Weeks run Monday to Sunday (ISO week numbers, Lagos time). Reports lock at a set time each week and finalise a week later."),
        f("clipboard", "Scores you can explain", "Equal-weight goals, equal-weight tasks and written rules. A finalised score is stored as history and never silently rewritten."),
        f("shield", "Governance built in", "Late-report exceptions, holiday amendments and score corrections need a reason, a second person and leave an audit record."),
        f("wallet", "Attendance and finance", "Violations, fines, payments and disbursements follow approval steps, and every ledger entry is permanent."),
        f("chart", "Reports with their sources", "Each report states its definition, period and scope. Exports and official snapshots carry the same details."),
      ],
    },
    {
      id: "how-it-works", type: "steps", enabled: true, title: "How a week works", intro: "", background: "surface", columns: 4, button: null, imageSlot: null,
      items: [
        { title: "Plan", text: "Business Unit Leads write SMART goals and tasks for the week." }, { title: "Lock", text: "At the content lock goals and tasks freeze; only outcomes can change." },
        { title: "Finalise", text: "At the final lock the week is scored and recorded." }, { title: "Review", text: "Reviewers confirm the report, and leadership sees the result." },
      ],
    },
    { id: "numbers", type: "stats", enabled: false, title: "Our results", intro: "", background: "white", columns: 4, button: null, imageSlot: null, items: [{ value: "13", label: "Weeks in every quarter" }, { value: "100%", label: "Changes audited" }, { value: "2", label: "People approve every sensitive change" }] },
    { id: "gallery", type: "gallery", enabled: false, title: "See it in action", intro: "", background: "white", columns: 3, button: null, imageSlot: null, items: [] },
    { id: "quote", type: "quote", enabled: false, title: "", intro: "", background: "surface", columns: 2, button: null, imageSlot: null, items: [{ text: "Add a short testimonial from your team here.", author: "Name", role: "Role" }] },
    {
      id: "trust", type: "trust", enabled: true, title: "Access you can account for", intro: "Everyone signs in with their own account. Leadership, finance and administration roles add an authenticator code. What you can see and do depends on your role and your Business Unit, and the server checks it every time.", background: "white", columns: 2, button: null, imageSlot: null,
      items: [{ text: "Role- and Business-Unit-based access, enforced by the database" }, { text: "Authenticator-app verification for elevated roles" }, { text: "An audit record for every sensitive change" }, { text: "Finalised scores, payments and ledger entries are kept as permanent history" }],
    },
    { id: "cta", type: "cta", enabled: true, title: "Ready to open your workspace?", intro: "Sign in with your 4CORE work account.", background: "brand", columns: 2, button: { label: "Sign in", href: "/login" }, imageSlot: null, items: [] },
  ],
  footer: { text: "© 4CORE INTEGRATED SERVICES", showSignIn: true, links: [] },
};

export const DEFAULT_LOGIN: LoginConfig = {
  layout: "split-left",
  panel: {
    tone: "brand", headline: "Objectives that turn into weekly work, and weekly work that turns into results.",
    points: [
      { icon: "calendar", text: "One weekly cadence: plan, lock, then finalise on a schedule your administrators set." },
      { icon: "chart", text: "Scores follow written rules, so every figure can be traced to its source." },
      { icon: "shield", text: "Access is by role and Business Unit, with a full audit trail." },
    ],
    footerText: "4CORE INTEGRATED SERVICES · Internal performance platform", showLogo: true, showImage: false, showArt: true, imageSlot: null, imageAlt: "", overlay: 55,
  },
  form: {
    title: "Sign in", subtitle: "Use your 4CORE work account to open your workspace.",
    footnote: "Access is granted by your administrator. If you cannot sign in, contact them. This page never reveals whether an account exists.",
    showForgot: true, forgotLabel: "Forgot your password?", showBackLink: false, backLabel: "Back to the home page",
  },
};

export const DEFAULT_SITE: SiteConfig = { landing: DEFAULT_LANDING, login: DEFAULT_LOGIN };

// ---------------------------------------------------------------- resolving what is stored
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Objects merge field by field; arrays and values replace. A stored value that no longer fits the schema falls back to the default for that part. */
function merge(base: unknown, over: unknown): unknown {
  if (isObj(base) && isObj(over)) { const out: Record<string, unknown> = { ...base }; for (const k of Object.keys(over)) out[k] = k in base ? merge(base[k], over[k]) : over[k]; return out; }
  return over === undefined ? base : over;
}

export function resolveSite(raw: { landing?: unknown; login?: unknown } | null | undefined): SiteConfig {
  const landing = landingSchema.safeParse(merge(DEFAULT_LANDING, raw?.landing ?? {}));
  const login = loginSchema.safeParse(merge(DEFAULT_LOGIN, raw?.login ?? {}));
  return { landing: landing.success ? landing.data : DEFAULT_LANDING, login: login.success ? login.data : DEFAULT_LOGIN };
}

/** Every image slot a configuration refers to, so unused uploads can be cleared. */
export function referencedSlots(site: SiteConfig): string[] {
  const out = new Set<string>();
  const add = (s: string | null | undefined) => { if (s) out.add(s); };
  add(site.landing.hero.imageSlot); add(site.login.panel.imageSlot);
  for (const s of site.landing.sections) { add(s.imageSlot); for (const i of s.items) add(i.imageSlot); }
  return [...out];
}

export const IMAGE_LIMIT_BYTES = 2_000_000;
export const IMAGE_MAX_COUNT = 40;
export const newSlot = () => `img-${Math.random().toString(36).slice(2, 10)}`;
