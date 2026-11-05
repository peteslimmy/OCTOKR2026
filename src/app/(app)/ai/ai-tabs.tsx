import Link from "next/link";

type Section = "admin" | "assistant" | "executive" | "remarks" | "closure" | "cases" | "approvals" | "reports" | "communications" | "monitoring";

/** The module's own sections. A section shows only to people who may use it. */
export function AiTabs({ current, monitoring, approvals = false, executive = false, communications = false, admin = false }: { current: Section; monitoring: boolean; approvals?: boolean; executive?: boolean; communications?: boolean; admin?: boolean }) {
  const tabs: { id: Section; href: string; label: string }[] = [
    { id: "assistant", href: "/ai", label: "Assistant" },
    ...(executive ? [{ id: "executive" as const, href: "/ai/executive", label: "Executive" }] : []),
    { id: "remarks", href: "/ai/remarks", label: "Remarks" }, { id: "closure", href: "/ai/closure", label: "Closure" }, { id: "cases", href: "/ai/cases", label: "Cases" },
    ...(approvals ? [{ id: "approvals" as const, href: "/ai/approvals", label: "Approvals" }] : []),
    { id: "reports", href: "/ai/reports", label: "Reports" },
    ...(communications ? [{ id: "communications" as const, href: "/ai/communications", label: "Communications" }] : []),
    ...(monitoring ? [{ id: "monitoring" as const, href: "/ai/monitoring", label: "Monitoring" }] : []),
    ...(admin ? [{ id: "admin" as const, href: "/ai/admin", label: "Administration" }] : []),
  ];
  return (
    <nav aria-label="4COREPAL sections" className="mb-4 flex flex-wrap gap-1 border-b border-line print:hidden">
      {tabs.map((t) => <Link key={t.id} href={t.href} aria-current={t.id === current ? "page" : undefined} className={`-mb-px border-b-2 px-4 py-2 text-sm ${t.id === current ? "border-brand-700 font-semibold text-brand-800" : "border-transparent text-muted hover:text-ink"}`}>{t.label}</Link>)}
    </nav>
  );
}
