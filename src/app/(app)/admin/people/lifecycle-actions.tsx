"use client";

import { useState } from "react";
import { DialogForm, AreaF, SelectF, TextF } from "@/components/session-notes/forms";
import { apiRequest, toast } from "@/components/ui/client";

interface RoleOpt { code: string; name: string; privileged: boolean }

/**
 * Move a person to another business unit and/or change their roles (for example make them BU Lead of the unit they are moving to), in one step.
 * A reason is required; the change is recorded in the person's journey. Which roles can be handed out is checked again by the database.
 */
export function MovePersonButton({ id, name, currentUnitId, units, roles, roleOptions, grantPrivileged }: {
  id: string; name: string; currentUnitId: string; units: { id: string; name: string }[]; roles: string[] | null; roleOptions: RoleOpt[]; grantPrivileged: boolean;
}) {
  const [unit, setUnit] = useState(currentUnitId);
  const [picked, setPicked] = useState<string[]>(roles ?? []);
  const [effective, setEffective] = useState("");
  const [reason, setReason] = useState("");
  const offered = roleOptions.filter((r) => grantPrivileged || !r.privileged || (roles ?? []).includes(r.code));
  const sameRoles = roles === null || [...picked].sort().join() === [...roles].sort().join();
  const unchanged = unit === currentUnitId && sameRoles;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <DialogForm label="Move or promote" title={`Move or promote ${name}`} description="Change the person's unit and/or roles. It takes effect now and is recorded in their journey with your reason; past reports keep the unit they were filed for."
      submitLabel="Save change" success="Saved. The change is in the person's journey." canSubmit={!unchanged && !!reason.trim() && (roles === null || picked.length > 0)}
      onOpen={() => { setUnit(currentUnitId); setPicked(roles ?? []); setEffective(""); setReason(""); }}
      onSubmit={async () => {
        const r = await apiRequest<{ source_unit_left_without_lead: boolean; target_unit_has_lead: boolean }>("POST", `employees/${id}/lifecycle`, {
          toBusinessUnitId: unit !== currentUnitId ? unit : null, roles: roles !== null && !sameRoles ? picked : null, effectiveDate: effective || null, reason: reason.trim(),
        });
        if (r.source_unit_left_without_lead) toast.warning("The unit this person left now has no BU Lead. Appoint one.");
        if (r.target_unit_has_lead && picked.includes("BU_LEAD")) toast.info("The new unit already has a BU Lead; it now has more than one.");
        return r;
      }}>
      <SelectF id={`mv-unit-${id}`} label="Business unit" value={unit} onChange={setUnit} options={units.map((u) => [u.id, u.id === currentUnitId ? `${u.name} (current)` : u.name] as const)} />
      {roles !== null ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-ink">Roles</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {offered.map((r) => (
              <label key={r.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picked.includes(r.code)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.code] : picked.filter((x) => x !== r.code))} />{r.name}</label>
            ))}
          </div>
          <p className="text-xs text-muted">Tick BU Lead to promote the person. A person needs at least one role.</p>
        </fieldset>
      ) : <p className="text-xs text-muted">This person has no sign-in, so only their unit can change.</p>}
      <TextF id={`mv-date-${id}`} label="Effective date (optional)" type="date" value={effective} onChange={setEffective} hint={`Today (${today}) or earlier; leave empty for today.`} />
      <AreaF id={`mv-why-${id}`} label="Reason" value={reason} onChange={setReason} rows={3} required max={2000} />
    </DialogForm>
  );
}
