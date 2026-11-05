"use client";

import { useState } from "react";
import { Badge, Card, CardHeader, DataTable } from "@/components/ui/primitives";
import { apiRequest } from "@/components/ui/client";
import { AreaF, DialogForm, SelectF, TextF } from "@/components/session-notes/forms";
import { ESCALATION_STAGES } from "@/lib/executive-oversight/constants";
import type { EoCategory, EoRule } from "@/lib/executive-oversight/types";

/** Admin and Super Admin manage the lists the module uses: the comment categories and the reminder/escalation timeline. They give no access to the commentary itself. */
export function SettingsPanel({ categories, rules, roles }: { categories: EoCategory[]; rules: EoRule[]; roles: { code: string; name: string }[] }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Comment categories" description="Offered when an Executive classifies a comment. A comment does not need one." action={<CategoryDialog />} />
        <DataTable caption="Comment categories" maxHeight={null} columns={[{ label: "Category" }, { label: "Code" }, { label: "Order", align: "right" }, { label: "Status" }, { label: "Change", srOnly: true }]}>
          {categories.map((c) => (
            <tr key={c.id}>
              <td><span className="font-medium text-ink">{c.name}</span>{c.description ? <p className="text-xs text-muted">{c.description}</p> : null}</td>
              <td className="font-mono text-xs">{c.code}</td><td className="text-right tabular-nums">{c.sort_order}</td>
              <td>{c.active ? <Badge tone="done">In use</Badge> : <Badge tone="locked">Switched off</Badge>}</td>
              <td className="text-right"><CategoryDialog existing={c} /></td>
            </tr>
          ))}
        </DataTable>
      </Card>
      <Card>
        <CardHeader title="Reminders and escalation" description="When a requested response is nearly due or overdue, who is told. This is communication only: it never changes a unit's compliance status, score or records." />
        <DataTable caption="Escalation timeline" maxHeight={null} columns={[{ label: "Stage" }, { label: "Days", align: "right" }, { label: "Who is told" }, { label: "Status" }, { label: "Change", srOnly: true }]}>
          {rules.map((r) => (
            <tr key={r.stage}>
              <td>{ESCALATION_STAGES[r.stage] ?? r.stage}</td><td className="text-right tabular-nums">{r.days}</td>
              <td>{{ BU_LEAD: "The unit's leads", RESPONSIBLE: "The responsible contact (or the leads)", AUTHOR: "The Executive who made it", ROLE: `Everyone in the ${roles.find((x) => x.code === r.role_code)?.name ?? r.role_code} role` }[r.recipient_kind]}</td>
              <td>{r.active ? <Badge tone="done">On</Badge> : <Badge tone="locked">Off</Badge>}</td>
              <td className="text-right"><RuleDialog rule={r} roles={roles} /></td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </div>
  );
}

function CategoryDialog({ existing }: { existing?: EoCategory }) {
  const [code, setCode] = useState(existing?.code ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [sort, setSort] = useState(String(existing?.sort_order ?? 100));
  const [active, setActive] = useState(existing?.active ?? true);
  return (
    <DialogForm label={existing ? "Edit" : "Add a category"} title={existing ? `Edit ${existing.name}` : "Add a comment category"} submitLabel="Save category" success="Category saved." variant={existing ? "ghost" : "primary"}
      canSubmit={!!name.trim() && (!!existing || /^[A-Z][A-Z0-9_]{1,39}$/.test(code))}
      onSubmit={() => apiRequest("POST", "executive-oversight/categories", { id: existing?.id ?? null, code: existing ? null : code, name: name.trim(), description: description.trim() || null, sortOrder: Number(sort) || 100, active })}>
      {!existing ? <TextF id="cat-code" label="Code" value={code} onChange={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} hint="Capital letters, digits and underscores; cannot be changed later." required max={40} /> : null}
      <TextF id="cat-name" label="Name" value={name} onChange={setName} required max={100} />
      <AreaF id="cat-desc" label="Description" value={description} onChange={setDescription} rows={2} max={500} />
      <TextF id="cat-sort" label="Order" value={sort} onChange={setSort} type="number" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Offered to Executives</label>
    </DialogForm>
  );
}

function RuleDialog({ rule, roles }: { rule: EoRule; roles: { code: string; name: string }[] }) {
  const [days, setDays] = useState(String(rule.days));
  const [kind, setKind] = useState(rule.recipient_kind);
  const [role, setRole] = useState(rule.role_code ?? "");
  const [active, setActive] = useState(rule.active);
  return (
    <DialogForm label="Change" title={ESCALATION_STAGES[rule.stage] ?? rule.stage} submitLabel="Save" success="Timeline saved." variant="ghost" canSubmit={days !== "" && (kind !== "ROLE" || !!role)}
      onSubmit={() => apiRequest("POST", "executive-oversight/escalation-rules", { stage: rule.stage, days: Number(days), recipientKind: kind, roleCode: kind === "ROLE" ? role : null, active })}>
      <TextF id={`rd-${rule.stage}`} label="Days" value={days} onChange={setDays} type="number" required />
      <SelectF id={`rk-${rule.stage}`} label="Who is told" value={kind} onChange={setKind} options={[["BU_LEAD", "The unit's leads"], ["RESPONSIBLE", "The responsible contact (or the leads)"], ["AUTHOR", "The Executive who made it"], ["ROLE", "Everyone in a role"]]} />
      {kind === "ROLE" ? <SelectF id={`rr-${rule.stage}`} label="Role" value={role} onChange={setRole} placeholder="Choose a role" options={roles.map((r) => [r.code, r.name] as const)} /> : null}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> This stage is on</label>
    </DialogForm>
  );
}
