import Link from "next/link";

/** The three parts of administration. */
export function AiAdminTabs({ current }: { current: "settings" | "policies" | "usage" }) {
  const tabs = [{ id: "settings", href: "/ai/admin", label: "Switch and settings" }, { id: "policies", href: "/ai/admin/policies", label: "What it may do" }, { id: "usage", href: "/ai/admin/usage", label: "Usage and activity" }] as const;
  return (
    <nav aria-label="Administration sections" className="mb-4 flex flex-wrap gap-2">
      {tabs.map((t) => <Link key={t.id} href={t.href} aria-current={t.id === current ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs ${t.id === current ? "border-brand-700 bg-brand-100 font-semibold text-brand-800" : "border-line text-muted hover:text-ink"}`}>{t.label}</Link>)}
    </nav>
  );
}
