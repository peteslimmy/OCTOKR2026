import type { Metadata } from "next";
import { Banner, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { userClient } from "@/lib/supabase/server";
import { AiAdminTabs } from "../admin-tabs";
import { AiTabs } from "../../ai-tabs";
import { EscalationStep, PolicyRow } from "../admin-forms";
import { Notice } from "../../notice";

export const metadata: Metadata = { title: "What it may do · 4COREPAL" };
type Policy = { action_type: string; risk: "LOW" | "MEDIUM" | "HIGH"; mode: string; label: string };
type Step = { severity: string; step: number; audience: string; after_hours: number };
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export default async function PoliciesPage() {
  const actor = await requireActor();
  if (!can(actor, "ai.config.manage") && !can(actor, "ai.audit.view") && !can(actor, "ai.escalation.manage")) return <Notice><EmptyState title="Administration is for the people who manage 4COREPAL" /></Notice>;
  const sb = await userClient();
  const [p, e] = await Promise.all([sb.from("ai_action_policies").select("action_type, risk, mode, label").order("risk").order("label"), sb.from("ai_escalation_policies").select("severity, step, audience, after_hours").order("step")]);
  const policies = (p.data ?? []) as Policy[], steps = (e.data ?? []) as Step[];
  const manage = can(actor, "ai.config.manage"), escalate = can(actor, "ai.escalation.manage");
  const order = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  return (
    <>
      <PageHeader title="What 4COREPAL may do" description="Autonomy is governed by risk. Low-risk actions may run on their own; medium-risk ones follow the ownership and approval rules you set; high-impact ones always wait for a person and can never be made automatic." />
      <AiTabs current="admin" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin />
      <AiAdminTabs current="policies" />
      <div className="space-y-6">
        <Banner tone="info" title="Three rules no setting can change">The agent never changes its own permissions, settings or policies. A person never approves their own proposal. A high-impact action (changing a goal, a target, a score, a historical record, ownership, cancelling a commitment, or a formal decision about a person) is never automatic.</Banner>
        <Card>
          <CardHeader title="Actions" description="Switch an action off to stop it altogether. Choosing Needs approval on an action the agent normally does by itself (for example asking a unit for remarks) stops it doing so until the approval step exists for it: it will not act." />
          <DataTable caption="What the agent may do, by action" columns={[{ label: "Action" }, { label: "Risk" }, { label: "Mode" }, { label: "Save", srOnly: true }]} maxHeight={null}>
            {[...policies].sort((a, b) => order[a.risk] - order[b.risk] || a.label.localeCompare(b.label)).map((x) => manage
              ? <PolicyRow key={x.action_type} action={x.action_type} label={x.label} risk={x.risk} mode={x.mode} />
              : <tr key={x.action_type}><td className="font-medium">{x.label}</td><td className="text-muted">{x.risk.toLowerCase()}</td><td>{x.mode.replace("_", " ").toLowerCase()}</td><td /></tr>)}
          </DataTable>
        </Card>
        <Card>
          <CardHeader title="Who is asked, and when" description="If a case goes unanswered, these steps say who is told after how many hours from when it was opened. A response from the unit stops the later steps. Every severity must keep a step that reaches the executives." />
          {SEVERITIES.map((sev) => {
            const mine = steps.filter((s) => s.severity === sev).sort((a, b) => a.step - b.step);
            return (
              <section key={sev} className="border-t border-line first:border-t-0" aria-label={`${sev.toLowerCase()} cases`}>
                <h3 className="bg-surface px-6 py-2 text-sm font-semibold">{sev.charAt(0) + sev.slice(1).toLowerCase()} cases</h3>
                <ul className="divide-y divide-line">
                  {mine.map((s) => escalate ? <EscalationStep key={s.step} severity={sev} step={s.step} audience={s.audience} afterHours={s.after_hours} /> : <li key={s.step} className="px-6 py-2 text-sm">Step {s.step}: {s.audience === "EXECUTIVES" ? "the executives" : s.audience === "BU_LEAD" ? "the unit's leads" : "every affected unit's leads"} after {s.after_hours} hours</li>)}
                  {escalate && mine.length < 5 ? <EscalationStep key={`new-${mine.length}`} severity={sev} step={Math.min(5, (mine[mine.length - 1]?.step ?? 0) + 1)} audience="EXECUTIVES" afterHours={72} isNew /> : null}
                </ul>
              </section>
            );
          })}
        </Card>
      </div>
    </>
  );
}
