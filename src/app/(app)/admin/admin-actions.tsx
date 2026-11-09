"use client";

import { useState } from "react";
import { ApiFailure, apiRequest, ConfirmButton, Modal, toast, useAction, useOpenOnNew } from "@/components/ui/client";
import { Badge, Banner, Button, Input, Label, Select, Textarea, Field } from "@/components/ui/primitives";
import { ReviewRow, StepForm } from "@/components/ui/step-form";

/** Roles are data (ADR-069): the screen is given the roles that exist and which of them need role-management permission to hand out. */
export interface RoleOption { code: string; name: string; privileged: boolean }

export function CreateBu({ units = [] }: { units?: { id: string; code: string; name: string }[] }) {
  const [open, setOpen] = useState(useOpenOnNew("unit"));
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentUnitId, setParentUnitId] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [kind, setKind] = useState<"BU" | "DEPARTMENT">("BU");
  const [weekly, setWeekly] = useState(true);
  const { run, pending } = useAction();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Add unit</Button>
      <Modal open={open} onOpenChange={setOpen} title="Add a Business Unit or Department" description="Every staff member belongs to one unit. Choose its type and whether it files a weekly report.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => apiRequest("POST", "business-units", { code, name, reportsWeekly: weekly, unitType: kind === "BU" ? "BUSINESS_UNIT" : "DEPARTMENT", parentUnitId: parentUnitId || null, description: description.trim() || null, location: location.trim() || null }), { success: kind === "BU" ? "Business Unit created." : "Department created." }); if (ok) { setOpen(false); setCode(""); setName(""); setParentUnitId(""); setDescription(""); setLocation(""); } }}>
          <Field id="bu-kind" label="Type"><Select value={kind} onChange={(e) => { const k = e.target.value as "BU" | "DEPARTMENT"; setKind(k); setWeekly(k === "BU"); }}><option value="BU">Business Unit</option><option value="DEPARTMENT">Department</option></Select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} /> Files a weekly report (is scored and ranked)</label>
          <Field id="bu-code" label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} required /></Field>
          <Field id="bu-name" label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required /></Field>
          <Field id="bu-parent" label="Parent unit (optional)"><Select value={parentUnitId} onChange={(e) => setParentUnitId(e.target.value)}><option value="">None</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}</Select></Field>
          <Field id="bu-description" label="Description (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></Field>
          <Field id="bu-location" label="Location (optional)"><Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>Create</Button></div>
        </form>
      </Modal>
    </>
  );
}

export function BuReportingToggle({ id, name, status, reportsWeekly }: { id: string; name: string; status: string; reportsWeekly: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  return (
    <>
      <Button size="sm" variant="secondary" aria-label={`${reportsWeekly ? "Stop weekly reporting" : "Require weekly reporting"} for ${name}`} onClick={() => setOpen(true)}>{reportsWeekly ? "Stop weekly reporting" : "Require weekly reporting"}</Button>
      <Modal open={open} onOpenChange={setOpen} title={reportsWeekly ? `${name}: stop requiring weekly reports?` : `${name}: require weekly reports?`}
        description={(reportsWeekly
          ? "No report, missing-report zero or ranking will apply from the next finalised week. Weeks already finalised keep their recorded scores."
          : "This Business Unit will be expected to submit a report each week and will be ranked.") + " A different Admin or Super Admin must approve the change."}>
        <div className="space-y-3">
          <Field id={`bu-reason-${id}`} label="Reason for the approver"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending || reason.trim() === ""} onClick={async () => {
              const ok = await run(() => apiRequest("PATCH", `business-units/${id}`, { name, status, reportsWeekly: !reportsWeekly, reason }), { success: "Sent for approval." });
              if (ok) { setOpen(false); setReason(""); }
            }}>Send for approval</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Super Admin only (the page renders it only for business_units.change_type; the API and database enforce it again). */
export function ChangeUnitType({ id, name, unitType, childUnits, employees, reportsWeekly }: { id: string; name: string; unitType: string; childUnits: number; employees: number; reportsWeekly: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  const toDept = unitType === "BUSINESS_UNIT";
  const label = toDept ? "Make a Department" : "Make a Business Unit";
  return (
    <>
      <Button size="sm" variant="secondary" aria-label={`${label}: ${name}`} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} title={`${name}: ${toDept ? "change to a Department" : "change to a Business Unit"}?`}
        description={`The unit moves to the ${toDept ? "Departments" : "Business Units"} list. Only the type changes: ${reportsWeekly ? "it keeps reporting weekly" : "it keeps not reporting weekly"}, and its scores, reports, ${employees} ${employees === 1 ? "person" : "people"}${childUnits > 0 ? ` and ${childUnits} child ${childUnits === 1 ? "unit" : "units"}` : ""} are untouched. Use the reporting control to change whether it files weekly reports. The change is recorded in the audit log.`}>
        <div className="space-y-3">
          <Field id={`bu-type-reason-${id}`} label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setReason(""); }}>Cancel</Button>
            <Button disabled={pending || !reason.trim()} onClick={async () => {
              const ok = await run(() => apiRequest("POST", `business-units/${id}/type`, { unitType: toDept ? "DEPARTMENT" : "BUSINESS_UNIT", reason }), { success: toDept ? `${name} is now a Department.` : `${name} is now a Business Unit.` });
              if (ok) { setOpen(false); setReason(""); }
            }}>Change type</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** What happened to the invitation email of a new person, in plain words, for the administrator who created them. */
export type InvitationInfo = { outcome: "SENT" | "NO_PROVIDER" | "FAILED" | string; message: string | null } | null;
function InvitationNote({ info, email }: { info: InvitationInfo; email: string }) {
  if (!info) return null;
  return info.outcome === "SENT"
    ? <Banner tone="done" title="Invitation emailed">We emailed {email} an invitation with a button to choose their password. The link works for 24 hours; you can resend it from the People page.</Banner>
    : <Banner tone="warn" title="Invitation not emailed">{info.message ?? "The invitation email could not be sent."}</Banner>;
}

export function CreateUserButton({ bus, grantPrivileged, roleOptions }: { bus: { id: string; name: string }[]; grantPrivileged: boolean; roleOptions: RoleOption[] }) {
  const [open, setOpen] = useState(useOpenOnNew("user"));
  const [f, setF] = useState({ email: "", firstName: "", lastName: "", businessUnitId: "", roles: [] as string[] });
  const [link, setLink] = useState<string | null>(null);
  const [pw, setPw] = useState<string | null>(null);
  const [inv, setInv] = useState<InvitationInfo>(null);
  const [err, setErr] = useState<string | null>(null);
  const { pending, run } = useAction();
  const roles = roleOptions.filter((r) => grantPrivileged || !r.privileged);
  return (
    <>
      <Button size="sm" onClick={() => { setOpen(true); setLink(null); setPw(null); setInv(null); setErr(null); }}>Add user</Button>
      <Modal open={open} onOpenChange={setOpen} title="Add user" description="The person is emailed an invitation to set their password. A first-login password and a setup link are also shown to you, in case you need to pass them on.">
        {link ? (
          <div className="space-y-3">
            <Banner tone="done" title="User created">The account is ready. The initial password below is shown only now; they will be asked to choose their own password when they first sign in.</Banner>
            <InvitationNote info={inv} email={f.email} />
            {pw ? <div><Label htmlFor="u-pw">Initial password</Label><div className="flex gap-2"><Input id="u-pw" readOnly value={pw} className="font-mono" onFocus={(e) => e.currentTarget.select()} /><Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(pw); toast.info("Password copied."); }}>Copy</Button></div></div> : null}
            <div><Label htmlFor="u-link">Or a one-time setup link, where they choose their own password</Label><Input id="u-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} /></div>
            <div className="flex justify-end"><Button onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <>
            <StepForm submitLabel="Create user" pending={pending} onCancel={() => setOpen(false)}
              onSubmit={async () => {
                setErr(null);
                const out = await run(async () => {
                  try { return await apiRequest<{ setupLink: string | null; initialPassword?: string; invitation?: InvitationInfo }>("POST", "users", f); } catch (x) { setErr((x as ApiFailure).message); throw x; }
                }, { success: "User created." });
                if (out) { setInv(out.value.invitation ?? null); setPw(out.value.initialPassword ?? null); setLink(out.value.setupLink ?? "(no link generated — use password recovery)"); }
              }}
              steps={[
                { id: "person", title: "Person", valid: !!f.firstName.trim() && !!f.lastName.trim() && !!f.email.trim(), content: (<>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="u-first" label="First name"><Input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} required /></Field>
                    <Field id="u-last" label="Last name"><Input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} required /></Field>
                  </div>
                  <Field id="u-email" label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field></>) },
                { id: "access", title: "Unit and roles", valid: !!f.businessUnitId && f.roles.length > 0, content: (<>
                  <div><Label htmlFor="u-bu">Business Unit or Department</Label><Select id="u-bu" value={f.businessUnitId} onChange={(e) => setF({ ...f, businessUnitId: e.target.value })} required><option value="">Select…</option>{bus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div>
                  <fieldset><legend className="mb-1 text-sm font-medium">Roles</legend>
                    <div className="grid grid-cols-2 gap-1">{roles.map((r) => (
                      <label key={r.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.roles.includes(r.code)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r.code] : f.roles.filter((x) => x !== r.code) })} />{r.name}</label>))}</div>
                  </fieldset></>) },
                { id: "review", title: "Review", content: (
                  <dl aria-label="User summary"><ReviewRow label="Name">{`${f.firstName} ${f.lastName}`}</ReviewRow><ReviewRow label="Email">{f.email}</ReviewRow>
                    <ReviewRow label="Unit">{bus.find((b) => b.id === f.businessUnitId)?.name}</ReviewRow><ReviewRow label="Roles">{roles.filter((r) => f.roles.includes(r.code)).map((r) => r.name).join(", ")}</ReviewRow></dl>) },
              ]} />
            {err ? <p role="alert" className="mt-2 text-sm text-[var(--critical-fg)]">{err}</p> : null}
          </>
        )}
      </Modal>
    </>
  );
}

const DESIGNATIONS: [string, string, string][] = [
  ["attendance.amendment.approve", "Attendance amendment approver", "May approve or reject attendance corrections requested by someone else. Never their own."],
  ["attendance.amendment.request", "Attendance amendment requester", "May request corrections to finalised attendance."],
  ["attendance.session.manage", "Attendance session manager", "May run rosters and Skip OKR for this week."],
  ["reporting.period.holiday.manage", "Organization Holiday manager", "May declare organisation holiday weeks."],
  ["weekly_report.review", "Weekly report reviewer", "May mark finalised reports reviewed."],
];

export function DesignationsButton({ id, held }: { id: string; held: string[] }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Designations{held.length ? ` (${held.length})` : ""}</Button>
      <Modal open={open} onOpenChange={setOpen} title="Individual designations" description="Grants a single capability to this person without changing their role. Every change is audited.">
        <ul className="space-y-3">
          {DESIGNATIONS.map(([code, label, help]) => {
            const on = held.includes(code);
            return (
              <li key={code} className="flex items-start justify-between gap-3 text-sm">
                <div><p className="font-medium">{label}</p><p className="text-muted">{help}</p></div>
                <Button size="sm" variant={on ? "danger" : "secondary"} disabled={pending}
                  onClick={() => run(() => apiRequest("PUT", `users/${id}/permissions`, { permission: code, grant: !on }), { success: on ? "Designation removed." : "Designation granted." })}>{on ? "Remove" : "Grant"}</Button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-end"><Button onClick={() => setOpen(false)}>Done</Button></div>
      </Modal>
    </>
  );
}

export function UserRowActions({ id, status, roles, grantPrivileged, roleOptions, email = "", neverSignedIn = false }: { id: string; status: string; roles: string[]; grantPrivileged: boolean; roleOptions: RoleOption[]; email?: string; neverSignedIn?: boolean }) {
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(roles);
  const privileged = new Set(roleOptions.filter((r) => r.privileged).map((r) => r.code));
  const lockedPrivileged = !grantPrivileged && roles.some((r) => privileged.has(r));
  return (
    <span className="inline-flex gap-1">
      <Button size="sm" variant="secondary" disabled={lockedPrivileged} onClick={() => { setSel(roles); setOpen(true); }}>Roles</Button>
      <Modal open={open} onOpenChange={setOpen} title="Change roles" description="You will see exactly which permissions each role carries in the audit entry.">
        <div className="grid grid-cols-2 gap-1">{roleOptions.filter((r) => grantPrivileged || !r.privileged || sel.includes(r.code)).map((r) => (
          <label key={r.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.includes(r.code)} disabled={!grantPrivileged && r.privileged} onChange={(e) => setSel(e.target.checked ? [...sel, r.code] : sel.filter((x) => x !== r.code))} />{r.name}</label>))}</div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={sel.length === 0} onClick={async () => { const ok = await run(() => apiRequest("PUT", `users/${id}/roles`, { roles: sel }), { success: "Roles updated." }); if (ok) setOpen(false); }}>Save roles</Button></div>
      </Modal>
      {status === "ACTIVE" && neverSignedIn ? <ResendInvitationButton id={id} email={email} /> : null}
      <MfaResetButton id={id} />
      {status === "ACTIVE"
        ? <ConfirmButton label="Suspend" variant="secondary" disabled={lockedPrivileged} title="Suspend user?" description="They lose all access immediately. Their history is preserved."
            onConfirm={() => run(() => apiRequest("POST", `users/${id}/suspend`), { success: "User suspended." })} />
        : <Button size="sm" variant="secondary" onClick={() => run(() => apiRequest("POST", `users/${id}/reactivate`), { success: "User reactivated." })}>Reactivate</Button>}
    </span>
  );
}

export function PenaltyRateForm({ current }: { current: number | null }) {
  const [pct, setPct] = useState(current === null ? "" : String(Number(current) * 100));
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  const n = Number(pct);
  const valid = pct !== "" && n > 0 && n <= 100 && reason.trim() !== "";
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => apiRequest("POST", "admin/penalty-rate", { rate: n / 100, reason }), { success: "Sent for approval. The rate changes, for future corrections only, once a different Admin or Super Admin approves." }); if (ok) setReason(""); }}>
      <Field id="rate" label="Penalty rate (%)"><Input type="number" step="0.01" min="0.01" max="100" value={pct} onChange={(e) => setPct(e.target.value)} className="w-40" /></Field>
      <Field id="rate-reason" label="Reason for the approver"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} className="w-72" /></Field>
      <Button type="submit" disabled={!valid || pending}>Send for approval</Button>
      <p className="text-sm text-muted">{current === null ? "No rate configured: penalties cannot be applied until you set one." : `Current rate: ${(Number(current) * 100).toFixed(2)}%`}</p>
    </form>
  );
}

export function HolidayForm({ weeks }: { weeks: { id: string; label: string; holiday: boolean; locked: boolean }[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Select whole reporting weeks</legend>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {weeks.map((w) => (
            <label key={w.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={w.holiday || w.locked} checked={sel.includes(w.id)} onChange={(e) => setSel(e.target.checked ? [...sel, w.id] : sel.filter((x) => x !== w.id))} />
              {w.label}{w.holiday ? " — holiday" : w.locked ? " — locked" : ""}
            </label>
          ))}
        </div>
      </fieldset>
      <Button disabled={sel.length === 0} onClick={() => setOpen(true)}>Declare Organization Holiday…</Button>
      <Modal open={open} onOpenChange={setOpen} title="Declare Organization Holiday" description="No BU weekly report will be required for the selected weeks. Ordinary report reminders and missing-report penalties are suppressed, and those weeks are excluded from quarterly scoring. All BU Leads are notified.">
        <div className="space-y-3">
          <p className="text-sm">{sel.length} week(s) selected.</p>
          <Field id="h-reason" label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!reason.trim() || pending} onClick={async () => {
              const ok = await run(() => apiRequest("POST", "reporting-weeks/organization-holiday", { reportingWeekIds: sel, reason, idempotencyKey: crypto.randomUUID(), confirm: true }), { success: "Organization Holiday declared. BU Leads notified." });
              if (ok) { setOpen(false); setSel([]); setReason(""); }
            }}>Confirm holiday</Button></div>
        </div>
      </Modal>
    </div>
  );
}

/** Controlled holiday amendment (quarter.score.amend): declare a locked/reported week a holiday, or reverse a holiday. */
export function HolidayAmendmentButton({ weekId, weekLabel, direction, request }: { weekId: string; weekLabel: string; direction: "DECLARE" | "REVERSE"; request?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());   // stable across retries of one attempt; rotated after success (the row becomes a Reverse button)
  const { run, pending } = useAction();
  const declare = direction === "DECLARE";
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{request ? (declare ? "Request holiday amendment" : "Request holiday reversal") : declare ? "Declare holiday (amendment)" : "Reverse holiday"}</Button>
      <Modal open={open} onOpenChange={setOpen} title={request ? (declare ? "Request a holiday amendment?" : "Request a holiday reversal?") : declare ? "Declare this week an Organization Holiday?" : "Reverse this Organization Holiday?"}
        description={request ? `${weekLabel} is closed. Nothing changes until a different Admin approves this request. The reason you give is shown to them and kept in the audit log.` : declare
          ? `${weekLabel}. The week leaves every Business Unit's quarterly score (numerator and denominator). New quarterly score versions are created; earlier scores, weekly scores and compliance records stay on record.`
          : `${weekLabel}. The week counts in quarterly scores again. If it has already final-locked, every Business Unit without a report receives a missing-report zero (use the late-report path to accept a late filing). New quarterly score versions are created.`}>
        <div className="space-y-3">
          <Field id={`ha-${weekId}`} label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={declare ? "primary" : "danger"} disabled={!reason.trim() || pending}
              onClick={async () => {
                const ok = await run(() => apiRequest("POST", `reporting-weeks/${weekId}/holiday-amendment${request ? "-request" : ""}`, { direction, reason, idempotencyKey: key, confirm: true }),
                  { success: request ? "Request sent. A different Admin must approve it." : declare ? "Holiday applied; quarterly scores versioned." : "Holiday reversed; quarterly scores versioned." });
                if (ok) { setOpen(false); setReason(""); setKey(crypto.randomUUID()); }
              }}>Confirm</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Sends a person who has never signed in their invitation again (a fresh one-time link; the earlier one stops working). */
function ResendInvitationButton({ id, email }: { id: string; email: string }) {
  const { run, pending } = useAction();
  const [link, setLink] = useState<string | null>(null);
  const [info, setInfo] = useState<InvitationInfo>(null);
  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={async () => {
        const r = await run(() => apiRequest<{ setupLink: string | null; invitation: InvitationInfo }>("POST", `users/${id}/invite`), { refresh: false });
        if (r) { setInfo(r.value.invitation); setLink(r.value.setupLink); }
      }}>{pending ? "Sending…" : "Resend invitation"}</Button>
      <Modal open={!!info} onOpenChange={(o) => { if (!o) { setInfo(null); setLink(null); } }} title="Invitation" description={email}>
        <div className="space-y-3">
          <InvitationNote info={info} email={email} />
          {link ? <div><Label htmlFor={`inv-link-${id}`}>One-time setup link, if you need to pass it on yourself</Label><Input id={`inv-link-${id}`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} /></div> : null}
          <div className="flex justify-end"><Button onClick={() => { setInfo(null); setLink(null); }}>Done</Button></div>
        </div>
      </Modal>
    </>
  );
}

/** Administrator-assisted recovery for a lost authenticator (needs a fresh authenticator code of the administrator, and a reason). */
function MfaResetButton({ id }: { id: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Reset authenticator</Button>
      <Modal open={open} onOpenChange={setOpen} title="Reset this user's authenticator?"
        description="Use this only when the user has lost their device and you have verified their identity. They must set up a new authenticator at their next sign-in. The reset is audited with your reason.">
        <div className="space-y-3">
          <Field id={`mfa-${id}`} label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={!reason.trim() || pending}
              onClick={async () => { const ok = await run(() => apiRequest("POST", `users/${id}/mfa-reset`, { reason }), { success: "Authenticator reset." }); if (ok) { setOpen(false); setReason(""); } }}>Reset</Button></div>
        </div>
      </Modal>
    </>
  );
}

/** Requests for closed weeks: pending ones can be approved or rejected by anyone EXCEPT the person who asked; the database enforces that too. */
export function HolidayRequests({ requests, me }: { requests: { id: string; status: "PENDING" | "APPLIED" | "REJECTED"; direction: "DECLARE" | "REVERSE"; reason: string; label: string; requestedBy: string | null; requestedById: string; decidedBy: string | null; comment: string | null; when: string }[]; me: string }) {
  const [target, setTarget] = useState<{ id: string; decision: "APPROVE" | "REJECT"; label: string } | null>(null);
  const [comment, setComment] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  if (requests.length === 0) return <p className="px-6 py-4 text-sm text-muted">No requests yet. A closed week needs a request and a second Admin.</p>;
  return (
    <>
      <ul className="divide-y divide-line" aria-label="Holiday amendment requests">
        {requests.map((r) => (
          <li key={r.id} className="space-y-1 px-6 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.label}</span>
              <Badge tone="info">{r.direction === "DECLARE" ? "Declare holiday" : "Reverse holiday"}</Badge>
              <Badge tone={r.status === "PENDING" ? "warn" : r.status === "APPLIED" ? "done" : "critical"}>{r.status === "PENDING" ? "Waiting for a second Admin" : r.status === "APPLIED" ? "Approved and applied" : "Rejected"}</Badge>
            </div>
            <p className="text-muted">Requested by {r.requestedBy ?? "someone"} · {r.when}. Reason: {r.reason}</p>
            {r.status !== "PENDING" ? <p className="text-muted">Decided by {r.decidedBy ?? "someone"}{r.comment ? `: ${r.comment}` : ""}</p> : null}
            {r.status === "PENDING" ? (
              r.requestedById === me ? <p className="text-xs text-muted">You made this request, so another Admin must decide it.</p> : (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => { setTarget({ id: r.id, decision: "APPROVE", label: r.label }); setComment(""); setKey(crypto.randomUUID()); }}>Approve<span className="sr-only"> request for {r.label}</span></Button>
                  <Button size="sm" variant="danger" onClick={() => { setTarget({ id: r.id, decision: "REJECT", label: r.label }); setComment(""); setKey(crypto.randomUUID()); }}>Reject<span className="sr-only"> request for {r.label}</span></Button>
                </div>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <Modal open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }} title={target?.decision === "APPROVE" ? "Approve and apply this amendment?" : "Reject this request?"}
        description={target?.decision === "APPROVE" ? `${target?.label}. Approving applies the change now: new quarterly score versions are created and every BU Lead is notified. Earlier records are kept.` : `${target?.label}. The requester is told why.`}>
        <div className="space-y-3">
          <Field id="hr-comment" label={target?.decision === "REJECT" ? "Reason for rejecting (required)" : "Comment (optional)"}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant={target?.decision === "REJECT" ? "danger" : "primary"} disabled={pending || (target?.decision === "REJECT" && !comment.trim())}
              onClick={async () => {
                if (!target) return;
                const ok = await run(() => apiRequest("POST", `holiday-amendment-requests/${target.id}/decision`, { decision: target.decision, comment: comment.trim() || undefined, idempotencyKey: key }),
                  { success: target.decision === "APPROVE" ? "Approved and applied; quarterly scores versioned." : "Request rejected." });
                if (ok) setTarget(null);
              }}>{target?.decision === "APPROVE" ? "Approve and apply" : "Reject request"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Gives an employee who is on the roster only (no sign-in) the ability to sign in, with the roles chosen here. */
export function GiveSignInButton({ id, name, email, grantPrivileged, roleOptions }: { id: string; name: string; email: string; grantPrivileged: boolean; roleOptions: RoleOption[] }) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [out, setOut] = useState<{ pw: string | null; link: string | null; inv: InvitationInfo } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { run, pending } = useAction();
  const options = roleOptions.filter((r) => grantPrivileged || !r.privileged);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setOpen(true); setOut(null); setErr(null); setRoles([]); }}>Give sign-in</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Give ${name} a sign-in`} description={`${email} keeps their unit and attendance record. They will sign in with this email.`}>
        {out ? (
          <div className="space-y-3">
            <Banner tone="done" title="Sign-in created">The initial password below is shown only now; they will be asked to choose their own password when they first sign in.</Banner>
            <InvitationNote info={out.inv} email={email} />
            {out.pw ? <div><Label htmlFor={`gs-pw-${id}`}>Initial password</Label><div className="flex gap-2"><Input id={`gs-pw-${id}`} readOnly value={out.pw} className="font-mono" onFocus={(e) => e.currentTarget.select()} /><Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(out.pw!); toast.info("Password copied."); }}>Copy</Button></div></div> : null}
            {out.link ? <div><Label htmlFor={`gs-link-${id}`}>Or a one-time setup link</Label><Input id={`gs-link-${id}`} readOnly value={out.link} onFocus={(e) => e.currentTarget.select()} /></div> : null}
            <div className="flex justify-end"><Button onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            const r = await run(async () => { try { return await apiRequest<{ setupLink: string | null; initialPassword?: string; invitation?: InvitationInfo }>("POST", "users", { employeeId: id, roles }); } catch (x) { setErr((x as ApiFailure).message); throw x; } }, { success: "Sign-in created." });
            if (r) setOut({ pw: r.value.initialPassword ?? null, link: r.value.setupLink, inv: r.value.invitation ?? null });
          }}>
            <fieldset><legend className="mb-1 text-sm font-medium">Roles</legend>
              <div className="grid grid-cols-2 gap-1">{options.map((r) => (
                <label key={r.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roles.includes(r.code)} onChange={(e) => setRoles(e.target.checked ? [...roles, r.code] : roles.filter((x) => x !== r.code))} />{r.name}</label>))}</div>
            </fieldset>
            {err ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{err}</p> : null}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || roles.length === 0}>{pending ? "Creating…" : "Create sign-in"}</Button></div>
          </form>
        )}
      </Modal>
    </>
  );
}

export function RosterToggle({ id, name, onRoster }: { id: string; name: string; onRoster: boolean }) {
  const { run } = useAction();
  return (
    <ConfirmButton label={onRoster ? "Take off roster" : "Put on roster"} variant="secondary" title={onRoster ? `Take ${name} off the attendance roster?` : `Put ${name} on the attendance roster?`}
      description={onRoster ? "They will not appear on new attendance rosters and cannot be marked absent. Rosters already created are not changed. Their sign-in is not affected." : "They will appear on new attendance rosters."}
      onConfirm={() => run(() => apiRequest("PATCH", `employees/${id}/roster`, { onRoster: !onRoster }), { success: onRoster ? "Taken off the roster." : "Put on the roster." })} />
  );
}

/** Delete a single Business Unit or Department */
export function DeleteBu({ id, name, code, hasEmployees, hasReports }: { id: string; name: string; code: string; hasEmployees: boolean; hasReports: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const disabled = hasEmployees || hasReports;

  return (
    <>
      <Button size="sm" variant="danger" disabled={disabled} aria-label={`Delete ${name} (${code})`} onClick={() => setOpen(true)}>Delete</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Delete ${name} (${code})?`}
        description={disabled
          ? (hasEmployees ? "This unit has employees and cannot be deleted. Reassign them first." : "This unit has weekly reports and cannot be deleted.")
          : "This will permanently delete the unit. This action cannot be undone. A reason is required for the audit log."}>
        <div className="space-y-3">
          {disabled ? (
            <p className="text-sm text-[var(--critical-fg)]">This unit cannot be deleted because it has dependent records.</p>
          ) : (
            <Field id={`bu-delete-reason-${id}`} label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setReason(""); }}>Cancel</Button>
            <Button variant="danger" disabled={pending || disabled || !reason.trim()} onClick={async () => {
              const ok = await run(() => apiRequest("DELETE", `business-units/${id}`, { reason }), { success: "Unit deleted." });
              if (ok) { setOpen(false); setReason(""); }
            }}>Delete</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Bulk delete Business Units/Departments */
export function BulkDeleteBu({ bus }: { bus: { id: string; name: string; code: string; hasEmployees: boolean; hasReports: boolean }[] }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const validSelection = sel.filter((id) => {
    const b = bus.find((x) => x.id === id);
    return b && !b.hasEmployees && !b.hasReports;
  });
  const invalidSelection = sel.filter((id) => {
    const b = bus.find((x) => x.id === id);
    return b && (b.hasEmployees || b.hasReports);
  });

  return (
    <>
      <Button size="sm" variant="danger" disabled={sel.length === 0} onClick={() => { setReason(""); setOpen(true); }}>Delete selected ({sel.length})</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Delete ${sel.length} unit(s)?`}
        description={`${validSelection.length} can be deleted${invalidSelection.length > 0 ? `, ${invalidSelection.length} have dependent records and will be skipped` : ""}. A reason is required for the audit log.`}>
        <div className="space-y-3">
          <Field id="bulk-bu-delete-reason" label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setReason(""); }}>Cancel</Button>
            <Button variant="danger" disabled={pending || validSelection.length === 0 || !reason.trim()} onClick={async () => {
              const ok = await run(() => apiRequest("POST", "business-units/bulk-delete", { ids: validSelection, reason }), { success: `${validSelection.length} unit(s) deleted.` });
              if (ok) { setOpen(false); setSel([]); setReason(""); }
            }}>Confirm delete</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Delete a single user (in UserRowActions) */
export function DeleteUserButton({ id, name, email, roles, isSelf, grantPrivileged, roleOptions }: { id: string; name: string; email: string; roles: string[]; isSelf: boolean; grantPrivileged: boolean; roleOptions: RoleOption[] }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const hasPrivileged = roles.some((r) => roleOptions.find((ro) => ro.code === r)?.privileged);

  return (
    <>
      <Button size="sm" variant="danger" disabled={isSelf} aria-label={`Delete ${name} (${email})`} onClick={() => setOpen(true)}>Delete</Button>
      <Modal open={open} onOpenChange={setOpen} title={isSelf ? "Cannot delete your own account" : `Delete ${name}?`}
        description={isSelf
          ? "You cannot delete your own account. Ask another Admin to do it."
          : `This will permanently delete ${name} (${email}) and their sign-in. ${hasPrivileged ? "⚠ This user holds privileged roles." : ""} Their history is preserved in audit logs. This requires your authenticator code.`}>
        <div className="space-y-3">
          {!isSelf && (
            <Field id={`user-delete-reason-${id}`} label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setReason(""); }}>Cancel</Button>
            {!isSelf && (
              <Button variant="danger" disabled={pending || !reason.trim()} onClick={async () => {
                const ok = await run(() => apiRequest("DELETE", `users/${id}/delete`, { reason }), { success: "User deleted." });
                if (ok) { setOpen(false); setReason(""); }
              }}>Delete</Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Bulk delete users */
export function BulkDeleteUsers({ users }: { users: { id: string; name: string; email: string; roles: string[] }[] }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  return (
    <>
      <Button size="sm" variant="danger" disabled={sel.length === 0} onClick={() => { setReason(""); setOpen(true); }}>Delete selected ({sel.length})</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Delete ${sel.length} user(s)?`}
        description="This will permanently delete the selected users and their sign-ins. This requires your authenticator code. A reason is required for the audit log.">
        <div className="space-y-3">
          <Field id="bulk-user-delete-reason" label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setReason(""); }}>Cancel</Button>
            <Button variant="danger" disabled={pending || !reason.trim()} onClick={async () => {
              const ok = await run(() => apiRequest("POST", "users/bulk-delete", { ids: sel, reason }), { success: `${sel.length} user(s) deleted.` });
              if (ok) { setOpen(false); setSel([]); setReason(""); }
            }}>Confirm delete</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Discard a draft weekly report */
export function DiscardReportButton({ reportId, reportStatus, submissionStatus }: { reportId: string; reportStatus: string; submissionStatus: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const canDelete = reportStatus === "OPEN" && submissionStatus === "NOT_SUBMITTED";

  return (
    <>
      <Button size="sm" variant="danger" disabled={!canDelete} onClick={() => setOpen(true)}>Discard draft</Button>
      <Modal open={open} onOpenChange={setOpen} title="Discard this draft report?"
        description={canDelete
          ? "This will permanently delete the draft report and all its goals and tasks. This action cannot be undone. A reason is required for the audit log."
          : "Only draft (not submitted) reports in OPEN state can be discarded."}>
        <div className="space-y-3">
          {canDelete && (
            <Field id={`report-delete-reason-${reportId}`} label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setReason(""); }}>Cancel</Button>
            {canDelete && (
              <Button variant="danger" disabled={pending || !reason.trim()} onClick={async () => {
                const ok = await run(() => apiRequest("DELETE", `weekly-reports/${reportId}`, { reason }), { success: "Draft report discarded." });
                if (ok) { setOpen(false); setReason(""); }
              }}>Discard</Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Super Admin: switch a week's content lock and final lock off so reports can be created or finished by hand, then back on. */
export function WeekLockSwitch({ weekId, weekLabel, suspended, disabled }: { weekId: string; weekLabel: string; suspended: boolean; disabled?: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button size="sm" variant={suspended ? "primary" : "secondary"} disabled={disabled} onClick={() => setOpen(true)}>{suspended ? "Restore locks" : "Suspend locks"}</Button>
      <Modal open={open} onOpenChange={setOpen} title={`${suspended ? "Restore" : "Suspend"} the locks for ${weekLabel}?`}
        description={suspended
          ? "The content lock and final lock apply again. If their times have already passed, the week locks and is finalised at the next scheduled run, and any report not submitted scores as normal."
          : "While suspended the week stays open: Business Unit Leads can create and edit goals and tasks, mark tasks and submit, whatever the clock says. The week is not locked or finalised until you restore the locks."}>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => apiRequest("POST", `reporting-weeks/${weekId}/lock-suspension`, { suspend: !suspended, reason }), { success: suspended ? "Locks restored." : "Locks suspended. The week is open for reporting." });
          if (ok) { setOpen(false); setReason(""); }
        }}>
          <Field id={`lock-reason-${weekId}`} label="Reason" hint="Recorded in the audit trail."><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !reason.trim()}>{suspended ? "Restore locks" : "Suspend locks"}</Button></div>
        </form>
      </Modal>
    </>
  );
}

const WAT_OFFSET_MS = 3_600_000;   // Africa/Lagos is UTC+1 all year
const toWatInput = (iso: string) => new Date(new Date(iso).getTime() + WAT_OFFSET_MS).toISOString().slice(0, 16);

/** Set when reporting opens for one week (Lagos time), or put it back on the default. */
export function WeekOpeningEditor({ weekId, weekLabel, opensAt, overridden }: { weekId: string; weekLabel: string; opensAt: string; overridden: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(toWatInput(opensAt));
  const [reason, setReason] = useState("");
  const send = async (iso: string | null, success: string) => {
    const ok = await run(() => apiRequest("POST", `reporting-weeks/${weekId}/opening`, { opensAt: iso, reason }), { success });
    if (ok) { setOpen(false); setReason(""); }
  };
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setValue(toWatInput(opensAt)); setOpen(true); }}>Change opening</Button>
      <Modal open={open} onOpenChange={setOpen} title={`When does reporting open for ${weekLabel}?`}
        description="Business Unit Leads can start the week's report from this moment (Lagos time). The content lock and final lock are not affected.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void send(`${value}:00+01:00`, "Opening time saved."); }}>
          <Field id={`open-at-${weekId}`} label="Reporting opens (WAT)"><Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} required /></Field>
          <Field id={`open-reason-${weekId}`} label="Reason" hint="Recorded in the audit trail."><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          <div className="flex flex-wrap justify-end gap-2">
            {overridden ? <Button type="button" variant="ghost" disabled={pending || !reason.trim()} onClick={() => void send(null, "Back to the default opening time.")}>Reset to default</Button> : null}
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !reason.trim() || !value}>Save</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
