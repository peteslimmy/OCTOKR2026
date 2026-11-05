import "server-only";
import { dbError } from "@/lib/data/errors";
import { getManagementBrief } from "@/lib/data/intelligence";
import { userClient } from "@/lib/supabase/server";
import type { CaseRow, Counts, PlanRow, RemarkReasonRow, ReportData } from "./reports";
import { liveToolData } from "./tools/live-data";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

/** What the reports read: the tools' data plus cases, plans, remarks and counts, all as the signed-in person (row-level security narrows every query). */
export function liveReportData(): ReportData {
  return {
    ...liveToolData(),
    async cases(): Promise<CaseRow[]> {
      const sb = await userClient();
      const { data, error } = await sb.from("ai_cases").select("reference, title, category, severity, status, detected_at, responded_at, response_due_at, business_units!ai_cases_business_unit_id_fkey(name)").order("detected_at", { ascending: false }).limit(300);
      if (error) throw dbError(error, "cases");
      return ((data ?? []) as unknown as { reference: string; title: string; category: string; severity: string; status: string; detected_at: string; responded_at: string | null; response_due_at: string | null; business_units: Rel<{ name: string }> }[])
        .map((c) => ({ reference: c.reference, title: c.title, category: c.category, severity: c.severity, status: c.status, unit: one(c.business_units)?.name ?? null, detectedAt: c.detected_at, respondedAt: c.responded_at, responseDueAt: c.response_due_at }));
    },
    async plans(): Promise<PlanRow[]> {
      const sb = await userClient();
      const { data, error } = await sb.from("ai_corrective_plans").select("id, status, effectiveness, baseline_score, review_score, review_date, ai_cases(reference), business_units(name)").order("created_at", { ascending: false }).limit(200);
      if (error) throw dbError(error, "corrective plans");
      const plans = (data ?? []) as unknown as { id: string; status: string; effectiveness: string | null; baseline_score: number | null; review_score: number | null; review_date: string | null; ai_cases: Rel<{ reference: string }>; business_units: Rel<{ name: string }> }[];
      const acts = plans.length ? (((await sb.from("ai_corrective_actions").select("plan_id, status").in("plan_id", plans.map((p) => p.id))).data ?? []) as { plan_id: string; status: string }[]) : [];
      return plans.map((p) => ({ caseReference: one(p.ai_cases)?.reference ?? "", unit: one(p.business_units)?.name ?? null, status: p.status, effectiveness: p.effectiveness,
        baseline: p.baseline_score === null ? null : Number(p.baseline_score), review: p.review_score === null ? null : Number(p.review_score), reviewDate: p.review_date,
        actionsDone: acts.filter((a) => a.plan_id === p.id && a.status === "DONE").length, actionsTotal: acts.filter((a) => a.plan_id === p.id && a.status !== "CANCELLED").length }));
    },
    async remarkReasons(): Promise<RemarkReasonRow[]> {
      const sb = await userClient();
      const { data, error } = await sb.from("ai_task_remarks").select("reason_code, business_units(name)").limit(5000);
      if (error) throw dbError(error, "remarks");
      const by = new Map<string, RemarkReasonRow>();
      for (const r of (data ?? []) as unknown as { reason_code: string; business_units: Rel<{ name: string }> }[]) {
        const unit = one(r.business_units)?.name ?? "Unknown", k = `${unit}|${r.reason_code}`;
        by.set(k, { unit, reason: r.reason_code, n: (by.get(k)?.n ?? 0) + 1 });
      }
      return [...by.values()].sort((a, b) => b.n - a.n);
    },
    async coverage(quarterId) {
      try { return (await getManagementBrief(quarterId))?.brief.coverage ?? []; } catch { return []; }          // only executives may read the brief
    },
    async counts(): Promise<Counts> {
      const sb = await userClient();
      const { data, error } = await sb.rpc("read_ai_executive_counts");
      if (error) throw dbError(error, "counts");
      return data as Counts;
    },
  };
}
