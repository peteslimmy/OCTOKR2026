"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IntegrityDialog } from "@/components/integrity-dialog";
import { ComplianceBadge, GoalStatusBadge, PhaseBadge, ScoreText, SubmissionBadge, TaskStatusBadge } from "@/components/status";
import { Badge, Button, Card } from "@/components/ui/primitives";
import type { ReportView } from "@/lib/data";

export function PresenterView({ view, canCorrect, prevHref, nextHref, buName }: { view: ReportView; canCorrect: boolean; prevHref: string; nextHref: string; buName: string }) {
  const router = useRouter();
  const [ic, setIc] = useState<ReportView["goals"][number]["tasks"][number] | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]")) return;
      if (e.key === "ArrowRight") router.push(nextHref);
      if (e.key === "ArrowLeft") router.push(prevHref);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [router, nextHref, prevHref]);

  const correctable = canCorrect && (view.phase === "CONTENT_LOCKED" || view.phase === "FINAL_LOCKED");
  const final = view.snapshot?.final_score ?? view.score_preview.final_score;
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{buName}</h2>
            <div className="mt-2 flex flex-wrap gap-2"><PhaseBadge phase={view.phase} /><SubmissionBadge status={view.report.submission_status} /><ComplianceBadge status={view.compliance?.status} />
              {view.session_outcome === "SKIPPED" ? <Badge tone="warn">SKIPPED WEEK</Badge> : null}</div>
          </div>
          <div className="text-right"><p className="text-4xl font-semibold"><ScoreText value={final} /></p>
            <p className="text-sm text-muted">{view.score_preview.done_goals}/{view.score_preview.total_goals} goals done{view.snapshot ? " · final" : " · preview"}</p></div>
        </div>
        {view.report.skipped_session_summary_comment ? <blockquote className="mt-4 rounded-lg bg-surface p-4 text-sm"><p className="mb-1 font-medium">BU performance summary</p>{view.report.skipped_session_summary_comment}</blockquote> : null}
        <div className="mt-4 flex items-center justify-between">
          <Link href={prevHref} className="inline-flex items-center gap-1 text-sm text-brand-700 underline"><ChevronLeft className="h-4 w-4" aria-hidden />Previous BU</Link>
          <span className="text-xs text-muted">Tip: use ← → keys</span>
          <Link href={nextHref} className="inline-flex items-center gap-1 text-sm text-brand-700 underline">Next BU<ChevronRight className="h-4 w-4" aria-hidden /></Link>
        </div>
      </Card>

      {view.goals.length === 0 ? <Card><p className="p-6 text-sm text-muted">No goals were filed.</p></Card> : view.goals.map((g) => (
        <Card key={g.id} className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-lg font-semibold">{g.title}</h3>
            <div className="flex gap-2"><GoalStatusBadge status={g.status} pending={g.has_undefined_tasks && view.phase !== "FINAL_LOCKED"} />{g.goal_type === "STRETCH" ? <Badge tone="stretch">Stretch</Badge> : null}</div>
          </div>
          <p className="mt-1 text-sm text-muted">{g.sub_key_result ? `${g.sub_key_result.kr_code} ${g.sub_key_result.kr_title} → ${g.sub_key_result.code} ${g.sub_key_result.title}` : "Stretch goal — no Sub-KR"}</p>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {g.tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <span>{t.description}</span>
                <span className="flex items-center gap-2"><TaskStatusBadge status={t.status} />
                  {correctable && t.status !== "UNDEFINED" ? <Button size="sm" variant="ghost" onClick={() => setIc(t)}>Correct…</Button> : null}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {ic ? <IntegrityDialog task={ic} open onOpenChange={(o) => !o && setIc(null)} /> : null}
    </div>
  );
}
