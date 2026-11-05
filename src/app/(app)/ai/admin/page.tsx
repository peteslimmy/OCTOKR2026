import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getIntegrations } from "@/lib/data/integrations";
import { userClient } from "@/lib/supabase/server";
import { AiAdminTabs } from "./admin-tabs";
import { AiTabs } from "../ai-tabs";
import { EnableSwitch, SettingRow } from "./admin-forms";
import { Notice } from "../notice";

export const metadata: Metadata = { title: "Administration · 4COREPAL" };
type Setting = { key: string; value: boolean | number | string; kind: "boolean" | "number" | "string"; label: string; help: string | null };
const GROUPS: { title: string; description: string; keys: string[] }[] = [
  { title: "Privacy", description: "What leaves the building.", keys: ["pseudonymise_prompts"] },
  { title: "Schedules", description: "When the daily and monthly reviews run, in the time zone below. The daily review runs once a day after its time; the monthly review of open activities runs on the last day of the month after its time.", keys: ["timezone", "schedule_daily_time", "schedule_monthly_time"] },
  { title: "Remarks, reviews and flags", description: "When a unit is asked and how long it has to answer.", keys: ["remark_lookback_days", "remark_deadline_days", "remark_reminder_days", "remark_escalate_days", "closure_deadline_days", "carry_over_weeks_threshold", "score_drop_points"] },
  { title: "Cost and limits", description: "What the AI provider may cost and how often it may be asked. Enter the provider's current prices so that cost is counted; at 0 no cost is recorded and the daily ceiling cannot act.", keys: ["daily_cost_ceiling_usd", "price_input_per_mtok_usd", "price_output_per_mtok_usd", "user_rate_limit_per_hour", "request_timeout_seconds", "max_retries"] },
  { title: "Retention", description: "Conversation messages are deleted after this many days. Cases, remarks, decisions, usage and the audit log are records of what was done and are kept.", keys: ["retention_days_messages"] },
];

export default async function AdminPage() {
  const actor = await requireActor();
  if (!can(actor, "ai.config.manage") && !can(actor, "ai.audit.view")) return <Notice><EmptyState title="Administration is for the people who manage 4COREPAL" /></Notice>;
  const sb = await userClient();
  const { data } = await sb.from("ai_settings").select("key, value, kind, label, help").order("key");
  const settings = new Map(((data ?? []) as Setting[]).map((s) => [s.key, s]));
  const manage = can(actor, "ai.config.manage");
  const enabled = settings.get("enabled")?.value === true;
  const integ = can(actor, "integrations.view") ? await getIntegrations().catch(() => null) : null;
  const ai = integ?.items.find((i) => i.slot === "AI" && i.enabled), mail = integ?.items.find((i) => i.slot === "EMAIL" && i.enabled);
  const ready = !!ai && ai.last_test_ok === true;
  return (
    <>
      <PageHeader title="4COREPAL administration" description="Switch the module on, set what it may do and when, and watch what it costs and does. The rest of the application does not depend on any of this." />
      <AiTabs current="admin" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin />
      <AiAdminTabs current="settings" />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Switch" description="Off by default. While off, nothing monitors, sends or answers, and no 4COREPAL page or menu entry appears for anyone." action={<Badge tone={enabled ? "done" : "undefined"}>{enabled ? "On" : "Off"}</Badge>} />
          <div className="space-y-3 px-6 py-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-muted">AI provider</dt><dd>{integ === null ? "Ask someone with access to Integrations." : ai ? <>{ai.name} ({String(ai.settings.model ?? "no model")}) {ai.last_test_ok === true ? <Badge tone="done">Tested OK</Badge> : ai.last_test_ok === false ? <Badge tone="critical">Last test failed</Badge> : <Badge tone="warn">Not tested</Badge>}</> : <Badge tone="warn">None enabled</Badge>}</dd></div>
              <div><dt className="text-xs text-muted">Email</dt><dd>{integ === null ? "Ask someone with access to Integrations." : mail ? <>{mail.name} {mail.last_test_ok === true ? <Badge tone="done">Tested OK</Badge> : mail.last_test_ok === false ? <Badge tone="critical">Last test failed</Badge> : <Badge tone="warn">Not tested</Badge>}</> : <Badge tone="warn">Not configured: nothing is emailed</Badge>}</dd></div>
            </dl>
            {!enabled && integ !== null && !ready ? <Banner tone="warn" title="Set up the AI provider first">The assistant and written explanations need an AI provider that has been added and tested. The daily review, remark requests, cases and reports do not need one.</Banner> : null}
            <p className="text-xs text-muted">The provider, its model and key are set under <Link href="/admin/integrations" className="underline">Integrations</Link>, not here, so there is one place for secrets.</p>
            {manage ? <EnableSwitch enabled={enabled} /> : <p className="text-xs text-muted">Only a Super Admin can switch it.</p>}
          </div>
        </Card>
        {GROUPS.map((g) => {
          const rows = g.keys.map((k) => settings.get(k)).filter((s): s is Setting => !!s);
          return (
            <Card key={g.title}>
              <CardHeader title={g.title} description={g.description} />
              <ul className="divide-y divide-line">{rows.map((s) => manage ? <SettingRow key={s.key} k={s.key} label={s.label} help={s.help} kind={s.kind} value={s.value} /> : <li key={s.key} className="flex justify-between px-6 py-3 text-sm"><span>{s.label}</span><span className="font-medium">{String(s.value)}</span></li>)}</ul>
            </Card>
          );
        })}
        <Card>
          <CardHeader title="What it cannot do in this version" />
          <ul className="list-disc space-y-1 px-10 py-4 text-sm text-muted">
            <li>Nothing is applied to a goal, target, score or report automatically. An approved proposal is recorded as the decision; a person makes any change in the usual place.</li>
            <li>It uses the application&apos;s own records only. Policies, SOPs and other documents are not read; there is no document source to configure yet.</li>
            <li>Email goes through the existing email service and is sent only once that is configured and tested.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
