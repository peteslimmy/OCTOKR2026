// Reading access control in plain terms: what a person can actually do, why they can (or cannot), and where access deserves a second look.
// Pure functions over data the application already holds; nothing here changes anything.

export interface Capability { id: string; label: string; module: string; path: string | null; any?: string[]; all?: string[] }

/** The things people do in the application, and the permission(s) each needs. Used to answer "why can't I see…?" in words, not permission codes. */
export const CAPABILITIES: Capability[] = [
  { id: "weekly.file", label: "Create a weekly report and add goals", module: "Weekly reporting", path: "/weekly", all: ["weekly_report.view_own_bu", "weekly_report.create", "goal.create"] },
  { id: "weekly.submit", label: "Submit a weekly report", module: "Weekly reporting", path: "/weekly", all: ["weekly_report.submit"] },
  { id: "weekly.execute", label: "Mark tasks done or not done", module: "Weekly reporting", path: "/weekly", all: ["task.execute"] },
  { id: "weekly.on-behalf", label: "File weekly reports on behalf of any unit", module: "Weekly reporting", path: "/weekly", all: ["weekly_report.file_for_any_bu"] },
  { id: "weekly.review", label: "Review a finalised weekly report", module: "Weekly reporting", path: "/weekly", all: ["weekly_report.review"] },
  { id: "bugoals", label: "Keep the unit's own goals for the quarter", module: "Weekly reporting", path: "/bu-goals", all: ["bu_goals.manage"] },
  { id: "attendance.run", label: "Run an OKR session and take attendance", module: "Sessions & attendance", path: "/governance", all: ["attendance.session.manage", "attendance.record"] },
  { id: "attendance.skip", label: "Skip an OKR session (with a reason)", module: "Sessions & attendance", path: "/governance", all: ["attendance.session.manage"] },
  { id: "attendance.amend.request", label: "Ask for attendance to be corrected", module: "Sessions & attendance", path: "/governance/amendments", all: ["attendance.amendment.request"] },
  { id: "attendance.amend.approve", label: "Approve attendance corrections", module: "Sessions & attendance", path: "/governance/amendments", all: ["attendance.amendment.approve"] },
  { id: "violation.report", label: "Report a violation", module: "Violations", path: "/violations?tab=violations", all: ["violation.create"] },
  { id: "violation.settle", label: "Record a violation payment", module: "Violations", path: "/violations?tab=violations", all: ["violation.payment.record"] },
  { id: "violation.void", label: "Void a violation that was contested and won", module: "Violations", path: "/violations?tab=violations", all: ["violation.void"] },
  { id: "finance.request", label: "Request funds from the violation fund", module: "Finance & fund", path: "/violations?tab=fund", all: ["disbursement.create"] },
  { id: "finance.approve", label: "Approve or reject fund requests", module: "Finance & fund", path: "/violations?tab=fund", any: ["disbursement.approve", "disbursement.reject"] },
  { id: "finance.release", label: "Release approved funds", module: "Finance & fund", path: "/violations?tab=fund", all: ["disbursement.disburse"] },
  { id: "finance.ledger", label: "See the ledger", module: "Finance & fund", path: "/violations?tab=fund&view=ledger", all: ["finance.ledger.view"] },
  { id: "finance.purposes", label: "Manage the purposes offered on fund requests", module: "Finance & fund", path: "/violations?tab=fund", all: ["finance.purpose.manage"] },
  { id: "strategy.view", label: "See the strategy and its progress", module: "Strategy & OKRs", path: "/strategy", any: ["strategy.annual_theme.view", "strategy.objective.create", "weekly_report.view_all", "weekly_report.view_own_bu"] },
  { id: "strategy.edit", label: "Create and change objectives, key results and Sub-KRs", module: "Strategy & OKRs", path: "/strategy", any: ["strategy.objective.create", "strategy.kr.create", "strategy.subkr.create"] },
  { id: "present", label: "Present the week", module: "Reports & dashboards", path: "/presentation", all: ["presentation.view"] },
  { id: "dashboard.exec", label: "See the organisation-wide dashboard and the management brief", module: "Reports & dashboards", path: "/insights", all: ["dashboard.executive.view"] },
  { id: "reports.open", label: "Open the Reports module", module: "Reports & dashboards", path: "/reports", all: ["reports.view"] },
  { id: "reports.build", label: "Build and save reports", module: "Reports & dashboards", path: "/reports/builder", all: ["reports.build"] },
  { id: "reports.export", label: "Export reports", module: "Reports & dashboards", path: "/reports", all: ["reports.export"] },
  { id: "calendar.holiday", label: "Declare an organisation holiday", module: "Reporting calendar & integrity", path: "/admin/calendar", all: ["reporting.period.holiday.manage"] },
  { id: "calendar.window", label: "Change when reporting opens and locks", module: "Reporting calendar & integrity", path: "/admin/calendar", all: ["reporting.week.manage"] },
  { id: "calendar.suspend", label: "Suspend a week's locks to fill it in by hand", module: "Reporting calendar & integrity", path: "/admin/calendar", all: ["reporting.locks.suspend"] },
  { id: "integrity", label: "Correct a task after the lock", module: "Reporting calendar & integrity", path: "/weekly", all: ["integrity_correction.create"] },
  { id: "admin.users", label: "Add and manage people", module: "Administration & security", path: "/admin/people", all: ["users.manage"] },
  { id: "admin.roles.ask", label: "Ask for a role to be created or changed", module: "Administration & security", path: "/admin/roles", all: ["roles.request"] },
  { id: "admin.roles.manage", label: "Manage roles and give direct permissions", module: "Administration & security", path: "/admin/access", all: ["roles.manage"] },
  { id: "admin.units", label: "Manage business units", module: "Administration & security", path: "/admin/units", all: ["business_units.manage"] },
  { id: "admin.approve", label: "Approve configuration changes", module: "Administration & security", path: "/admin/approvals", all: ["config.approve"] },
  { id: "admin.audit", label: "Read the audit log", module: "Administration & security", path: "/audit", all: ["audit.read"] },
];

export interface RoleLite { code: string; name: string; permissions: string[]; requiresMfa: boolean }
export interface GrantLite { permission: string; reason: string | null; expiresAt: string | null; grantedBy: string | null }
export interface Source { kind: "role" | "grant"; label: string; expiresAt?: string | null }

/** Every permission a person holds, with where each comes from. An expired direct grant does not count. */
export function effectiveAccess(roles: string[], roleMap: Map<string, RoleLite>, grants: GrantLite[], now = new Date()): Map<string, Source[]> {
  const out = new Map<string, Source[]>();
  const add = (code: string, s: Source) => out.set(code, [...(out.get(code) ?? []), s]);
  for (const code of roles) { const r = roleMap.get(code); if (r) for (const p of r.permissions) add(p, { kind: "role", label: r.name }); }
  for (const g of grants) if (!g.expiresAt || new Date(g.expiresAt) > now) add(g.permission, { kind: "grant", label: "Direct grant", expiresAt: g.expiresAt });
  return out;
}

export interface CapabilityStatus { capability: Capability; allowed: boolean; missing: string[]; grantedByRoles: string[] }
/** For each thing people do: whether this person can, what is missing, and which existing role would give it. */
export function capabilityStatus(held: Set<string>, roles: RoleLite[]): CapabilityStatus[] {
  return CAPABILITIES.map((c) => {
    const need = c.all ?? [];
    const anyOk = c.any ? c.any.some((p) => held.has(p)) : true;
    const missing = [...need.filter((p) => !held.has(p)), ...(anyOk ? [] : [c.any![0]])];
    const wanted = c.any && !anyOk ? [...need, ...(c.any ?? []).slice(0, 1)] : need;
    const allowed = missing.length === 0;
    const grantedByRoles = allowed ? [] : roles.filter((r) => { const set = new Set(r.permissions); return c.any && !anyOk ? need.every((p) => held.has(p) || set.has(p)) && c.any.some((p) => set.has(p)) : wanted.every((p) => set.has(p) || held.has(p)); }).map((r) => r.name);
    return { capability: c, allowed, missing, grantedByRoles };
  });
}

export interface ConflictPair { a: string; b: string; reason: string }
export const conflictsHeld = (held: Set<string>, pairs: ConflictPair[]) => pairs.filter((p) => held.has(p.a) && held.has(p.b));

export interface ReviewUser { id: string; name: string; email: string; unit: string | null; status: string; roles: string[]; lastLoginAt: string | null; grants: GrantLite[] }
export interface ReviewFlag { id: string; severity: "high" | "medium" | "low"; title: string; detail: string; userIds: string[] }

/** What an access review would look at: privileged holders, dormant or unprotected high-risk accounts, expiring or open-ended grants, broken separation of duties. */
export function accessReview(input: { users: ReviewUser[]; roles: RoleLite[]; risk: Map<string, "low" | "medium" | "high" | "critical">; conflicts: ConflictPair[]; now?: Date }): ReviewFlag[] {
  const now = input.now ?? new Date();
  const roleMap = new Map(input.roles.map((r) => [r.code, r]));
  const flags: ReviewFlag[] = [];
  const active = input.users.filter((u) => u.status === "ACTIVE");
  const held = new Map(active.map((u) => [u.id, new Set(effectiveAccess(u.roles, roleMap, u.grants, now).keys())]));
  const critical = (id: string) => [...(held.get(id) ?? [])].filter((p) => input.risk.get(p) === "critical").length;
  const names = (ids: string[]) => ids.map((id) => active.find((u) => u.id === id)?.name ?? "").filter(Boolean).slice(0, 5).join(", ");

  const priv = active.filter((u) => critical(u.id) > 0).map((u) => u.id);
  if (priv.length) flags.push({ id: "privileged", severity: "low", title: `${priv.length} ${priv.length === 1 ? "person holds" : "people hold"} critical permissions`, detail: `${names(priv)}. Confirm each still needs them.`, userIds: priv });

  const dormant = active.filter((u) => critical(u.id) > 0 && (!u.lastLoginAt || now.getTime() - new Date(u.lastLoginAt).getTime() > 30 * 864e5)).map((u) => u.id);
  if (dormant.length) flags.push({ id: "dormant", severity: "high", title: "Critical access on accounts not used in 30 days", detail: `${names(dormant)} hold critical permissions but have not signed in for a month or more.`, userIds: dormant });

  const noMfa = active.filter((u) => critical(u.id) > 0 && !u.roles.some((r) => roleMap.get(r)?.requiresMfa)).map((u) => u.id);
  if (noMfa.length) flags.push({ id: "no-mfa", severity: "high", title: "Critical access without a required second factor", detail: `${names(noMfa)} hold critical permissions through roles that do not require an authenticator.`, userIds: noMfa });

  const sod = active.filter((u) => conflictsHeld(held.get(u.id) ?? new Set(), input.conflicts).length > 0).map((u) => u.id);
  if (sod.length) flags.push({ id: "sod", severity: "high", title: "Conflict of duties", detail: `${names(sod)} hold permissions that should be held by different people.`, userIds: sod });

  const open = active.filter((u) => u.grants.some((g) => !g.expiresAt)).map((u) => u.id);
  if (open.length) flags.push({ id: "open-grants", severity: "medium", title: "Direct grants with no end date", detail: `${names(open)} have permissions granted outside their role with no expiry. Set an end date or move the permission into a role.`, userIds: open });

  const soon = active.filter((u) => u.grants.some((g) => g.expiresAt && new Date(g.expiresAt) > now && new Date(g.expiresAt).getTime() - now.getTime() < 14 * 864e5)).map((u) => u.id);
  if (soon.length) flags.push({ id: "expiring", severity: "low", title: "Direct grants ending within two weeks", detail: `${names(soon)}. Renew them if the need continues.`, userIds: soon });

  const several = active.filter((u) => u.roles.length > 1).map((u) => u.id);
  if (several.length) flags.push({ id: "multi-role", severity: "low", title: "People with more than one role", detail: `${names(several)}. Check the combination is intended.`, userIds: several });

  const idle = input.roles.filter((r) => !active.some((u) => u.roles.includes(r.code)) && r.permissions.length > 0);
  if (idle.length) flags.push({ id: "idle-roles", severity: "low", title: `${idle.length} ${idle.length === 1 ? "role has" : "roles have"} nobody in ${idle.length === 1 ? "it" : "them"}`, detail: idle.map((r) => r.name).join(", "), userIds: [] });
  return flags;
}
