import type { Metadata } from "next";
import Link from "next/link";
import { Banner, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listConfigChanges } from "@/lib/data/config";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage() {
  const actor = await requireActor();
  const changes = await listConfigChanges();
  const waiting = changes.filter((c) => c.status === "PENDING").length;
  const any = (...p: string[]) => p.some((x) => can(actor, x));
  const tiles = [
    can(actor, "business_units.manage") && { href: "/admin/units", title: "Business Units & Departments", text: "Create units, choose which must report weekly." },
    can(actor, "users.manage") && { href: "/admin/people", title: "People", text: "Add users, assign roles, activate or deactivate." },
    any("roles.request", "users.manage", "roles.manage") && { href: "/admin/roles", title: "Roles & permissions", text: "Who can do what." },
    any("users.manage", "business_units.manage") && { href: "/admin/import", title: "Import", text: "Bring in employees and units from a spreadsheet." },
    can(actor, "history.import") && { href: "/admin/import/history", title: "Historical reports", text: "Load past weekly reports from a spreadsheet (Super Admin)." },
    can(actor, "strategy.import") && { href: "/admin/import/strategy", title: "Import strategy", text: "Load a quarter's objective, key results and Sub-KRs from a spreadsheet (Super Admin)." },
    any("reporting.period.holiday.manage", "quarter.score.amend") && { href: "/admin/calendar", title: "Calendar & holidays", text: "Organisation holidays and amendments." },
    any("integrity_penalty.configure", "reporting.week.manage", "retention.configure", "reminders.configure") && { href: "/admin/settings", title: "Settings", text: "Penalty rate, lock times, reminders, retention." },
    { href: "/admin/approvals", title: `Approvals${waiting ? ` (${waiting} waiting)` : ""}`, text: "Changes waiting for a second person to approve." },
    can(actor, "integrations.view") && { href: "/admin/integrations", title: "Integrations", text: "Email (SMTP), AI providers and webhooks." },
    can(actor, "branding.manage") && { href: "/admin/branding", title: "Branding", text: "Name, logo, favicon and colour." },
    can(actor, "branding.manage") && { href: "/admin/site", title: "Landing & sign-in", text: "Edit the public page and the sign-in screens, with pictures." },
    can(actor, "audit.read") && { href: "/audit", title: "Audit log", text: "Who did what, and when." },
  ].filter((t): t is { href: string; title: string; text: string } => !!t);
  return (
    <>
      <PageHeader title="Administration" description="Set up the organisation, people, calendar and rules. Every change is audited; governance settings are approved by a different person." />
      {waiting ? <div className="mb-6"><Banner tone="info" title={`${waiting} change${waiting === 1 ? " is" : "s are"} waiting for approval`}><Link href="/admin/approvals" className="underline">Open approvals</Link></Banner></div> : null}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.href}><Link href={t.href} className="block h-full rounded-xl border border-line bg-panel p-5 shadow-[var(--shadow-card)] hover:border-brand-700">
            <span className="block font-semibold">{t.title}</span><span className="mt-1 block text-sm text-muted">{t.text}</span>
          </Link></li>
        ))}
      </ul>
    </>
  );
}
