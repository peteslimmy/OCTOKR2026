import { redirect } from "next/navigation";
import { Shell, type CreateItem, type LockChip, type NavGroup, type NavItem } from "@/components/shell";
import { ClockProvider, StepUpHost } from "@/components/ui/client";
import { can, getActor } from "@/lib/auth/actor";
import { activeWeeks, currentQuarter, environmentInfo, serverNow, unreadCount } from "@/lib/data";
import { getBranding } from "@/lib/data/branding";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const [quarter, unread, env, branding, weeks] = await Promise.all([currentQuarter(), unreadCount(), environmentInfo(), getBranding(), activeWeeks().catch(() => [])]);
  const now = await serverNow();
  const devClock = env.clock_overridden ? now : null;
  // the deadlines that matter right now: the content lock of an open week, the final lock of a week that is locked but still being executed
  const lockText = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(new Date(iso));
  const locks: LockChip[] = weeks
    .filter((w) => w.reporting_state === "NORMAL")
    .flatMap((w): LockChip[] =>
      w.phase === "OPEN" ? [{ key: `c${w.id}`, kind: "content", weekNumber: w.week_number, at: w.content_lock_at, atText: lockText(w.content_lock_at) }]
      : w.phase === "CONTENT_LOCKED" ? [{ key: `f${w.id}`, kind: "final", weekNumber: w.week_number, at: w.final_lock_at, atText: lockText(w.final_lock_at) }]
      : [])
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const any = (...p: string[]) => p.some((x) => can(actor, x));

  // Navigation is grouped by what the person is trying to do. Each entry still shows only when the signed-in role may open it.
  const groups: NavGroup[] = [];
  const add = (label: string, items: (NavItem | false)[]) => { const kept = items.filter((i): i is NavItem => !!i); if (kept.length) groups.push({ label, items: kept }); };

  add("Overview", [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", hint: "Scores, tasks and what needs attention" }]);
  add("Execution", [
    { href: "/strategy", label: "Strategy & OKRs", icon: "strategy", hint: "Objective, key results, sub-KRs" },
    can(actor, "weekly_report.view_own_bu") && { href: "/weekly", label: "Weekly reports", icon: "weekly", hint: "Goals and tasks for the week" },
    any("weekly_report.view_all", "weekly_report.view_own_bu") && { href: "/performance", label: "Performance", icon: "performance", hint: "Scores by week" },
    can(actor, "presentation.view") && { href: "/presentation", label: "Presentation", icon: "presentation", hint: "Present the week to leadership" },
  ]);
  add("Governance", [
    any("attendance.session.manage", "attendance.amendment.view", "attendance.amendment.request", "attendance.amendment.approve") && { href: "/governance", label: "Sessions & attendance", icon: "governance", hint: "OKR sessions and who attended" },
    any("violation.create", "violation.edit") && { href: "/governance/violations", label: "Violations", icon: "violations", hint: "Raise and settle violations" },
    any("attendance.amendment.view", "attendance.amendment.request", "attendance.amendment.approve") && { href: "/governance/amendments", label: "Attendance amendments", icon: "amendments", hint: "Corrections to attendance" },
    any("quarter.score.amend", "weekly_report.review") && { href: "/governance/late-reports", label: "Late reports", icon: "amendments", hint: "Exceptions for missed reports" },
  ]);
  add("Finance", [
    any("finance.fund.view", "disbursement.create") && { href: "/finance", label: "Violation fund", icon: "finance", hint: "Balance, requests, approvals" },
    can(actor, "finance.ledger.view") && { href: "/finance/ledger", label: "Ledger", icon: "ledger", hint: "Every inflow and outflow" },
  ]);
  add("Insights", [
    can(actor, "reports.view") && { href: "/reports", label: "Reports", icon: "reports", hint: "Standard reports" },
    can(actor, "reports.view") && { href: "/reports/insights", label: "Insights", icon: "insights", hint: "What the data suggests" },
    can(actor, "reports.build") && { href: "/reports/builder", label: "Report builder", icon: "builder", hint: "Build and save your own" },
    can(actor, "reports.view") && { href: "/reports/saved", label: "Saved & snapshots", icon: "saved", hint: "Saved reports and frozen snapshots" },
  ]);
  add("People & organisation", [
    any("business_units.manage") && { href: "/admin/units", label: "Business Units & Departments", icon: "units", hint: "Create and manage units" },
    any("users.manage") && { href: "/admin/people", label: "People", icon: "people", hint: "Add and manage users" },
    any("roles.request", "users.manage", "roles.manage") && { href: "/admin/roles", label: "Roles & permissions", icon: "roles", hint: "Who can do what" },
    any("users.manage", "business_units.manage") && { href: "/admin/import", label: "Import", icon: "import", hint: "Bulk import employees and units" },
  ]);
  add("Administration", [
    any("business_units.manage", "users.manage", "reporting.period.holiday.manage", "integrity_penalty.configure", "reporting.week.manage", "branding.manage", "config.approve", "quarter.score.amend") && { href: "/admin", label: "Admin overview", icon: "settings", hint: "Everything to set up", exact: true },
    any("reporting.period.holiday.manage", "quarter.score.amend") && { href: "/admin/calendar", label: "Calendar & holidays", icon: "calendar", hint: "Organisation holidays and amendments" },
    any("integrity_penalty.configure", "reporting.week.manage", "retention.configure", "reminders.configure") && { href: "/admin/settings", label: "Settings", icon: "settings", hint: "Penalty, lock times, reminders, retention" },
    any("config.approve", "config.protected.approve", "violation.edit", "integrity_penalty.configure", "reminders.configure", "business_units.manage") && { href: "/admin/approvals", label: "Approvals", icon: "approvals", hint: "Changes waiting for a decision" },
    can(actor, "branding.manage") && { href: "/admin/branding", label: "Branding", icon: "branding", hint: "Name, logo, favicon, colour" },
    can(actor, "branding.manage") && { href: "/admin/site", label: "Landing & sign-in", icon: "site", hint: "Edit the public page and the sign-in screens" },
    can(actor, "audit.read") && { href: "/audit", label: "Audit log", icon: "audit", hint: "Who did what, and when" },
  ]);

  // The "+ Create" menu: the most common actions, one click from anywhere. Each opens its dialog on arrival.
  const create: CreateItem[] = [
    can(actor, "violation.create") && { href: "/governance/violations?new=violation", label: "Report a violation", hint: "Against a staff member" },
    can(actor, "disbursement.create") && { href: "/finance?new=disbursement", label: "Request a disbursement", hint: "From the violation fund" },
    can(actor, "users.manage") && { href: "/admin/people?new=user", label: "Add a user", hint: "Invite a person and give a role" },
    can(actor, "business_units.manage") && { href: "/admin/units?new=unit", label: "Add a Business Unit or Department", hint: "A unit staff belong to" },
    can(actor, "weekly_report.create") && { href: "/weekly", label: "Start a weekly report", hint: "Goals and tasks for this week" },
  ].filter((c): c is CreateItem => !!c);

  return (
    <ClockProvider serverNow={now}>
    <Shell groups={groups} create={create} brand={{ name: branding.appName, shortName: branding.shortName, logoUrl: branding.logoUrl, logoHeight: branding.logoHeight }}
      user={{ name: actor.name, roles: actor.roles, bu: actor.buName }} unread={unread}
      locks={locks} quarterLabel={quarter ? `Q${quarter.quarter_number} ${quarter.year}${quarter.status === "ACTIVE" ? "" : ` · ${quarter.status.toLowerCase()}`}` : null}>
      {devClock ? <div role="status" className="mb-4 rounded-lg bg-[var(--warn-bg)] px-4 py-2 text-sm font-medium text-[var(--warn-fg)]">DEVELOPMENT CLOCK ACTIVE — server time is frozen at {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(devClock))} WAT. Never enabled in production.</div> : null}
      {children}
      <StepUpHost />
    </Shell>
    </ClockProvider>
  );
}
