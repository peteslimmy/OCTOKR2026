import type { ReactNode } from "react";
import { wat } from "@/components/status";
import type { DisbursementRow } from "@/lib/data/governance";

const HIDDEN = "Administration";   // a name the viewer may not see (the reserve Super Admin account) is shown as the office
const gap = (from: string, to: string) => {
  const m = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  if (m < 2880) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
};

type State = "done" | "current" | "rejected" | "waiting" | "skipped";
const DOT: Record<State, { bg: string; fg: string; border: string; mark: string }> = {
  done: { bg: "var(--done-fg)", fg: "#fff", border: "var(--done-fg)", mark: "✓" },
  current: { bg: "transparent", fg: "var(--brand-700, #1e40af)", border: "var(--brand-700, #1e40af)", mark: "●" },
  rejected: { bg: "var(--critical-fg)", fg: "#fff", border: "var(--critical-fg)", mark: "✕" },
  waiting: { bg: "transparent", fg: "var(--muted, #6b7280)", border: "var(--line, #d1d5db)", mark: "" },
  skipped: { bg: "transparent", fg: "var(--muted, #6b7280)", border: "var(--line, #d1d5db)", mark: "–" },
};

function Step({ n, state, title, children, last }: { n: number; state: State; title: string; children: ReactNode; last?: boolean }) {
  const d = DOT[state];
  return (
    <li className="relative flex-1 pr-4">
      <div className="flex items-center">
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold" style={{ background: d.bg, color: d.fg, borderColor: d.border }}>{d.mark || n}</span>
        {!last ? <span aria-hidden className="mx-2 h-0.5 flex-1" style={{ background: state === "done" ? "var(--done-fg)" : "var(--line, #d1d5db)" }} /> : null}
      </div>
      <p className="mt-2 text-sm font-medium">{title}</p>
      <div className="mt-0.5 space-y-0.5 text-xs text-muted">{children}</div>
    </li>
  );
}

/** One request from the day it was raised to the day the money left: who did what, when, and how long each step took. */
export function RequestTrail({ r }: { r: DisbursementRow }) {
  const rejected = r.decision?.decision === "REJECTED";
  const approved = r.decision?.decision === "APPROVED";
  const released = !!r.disbursement;
  const requester = r.requester_name ?? HIDDEN;
  const deciderName = r.decision?.by ?? HIDDEN;
  const withdrawn = r.status === "WITHDRAWN";
  const stepTwo: State = withdrawn ? "skipped" : rejected ? "rejected" : approved ? "done" : "current";
  const stepThree: State = released ? "done" : rejected || withdrawn ? "skipped" : approved ? "current" : "waiting";
  const ref = (id: string) => `FR-${id.slice(0, 8).toUpperCase()}`;
  return (
    <div className="space-y-4">
      {r.resubmits ? <p className="rounded-md bg-surface px-3 py-2 text-sm"><span className="font-medium">Revised request</span> · replaces <span className="font-mono text-xs">{ref(r.resubmits)}</span>, which was rejected.{r.resubmit_note ? <> The requester says: “{r.resubmit_note}”</> : null}</p> : null}
      {r.resubmitted_as ? <p className="rounded-md bg-surface px-3 py-2 text-sm">Revised and resubmitted as <span className="font-mono text-xs">{ref(r.resubmitted_as)}</span>.</p> : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted">Raised by</dt><dd className="font-medium">{requester}</dd>{r.requester_unit ? <dd className="text-xs text-muted">{r.requester_unit}</dd> : null}</div>
        <div><dt className="text-xs text-muted">Raised on</dt><dd className="font-medium">{wat(r.created_at)}</dd></div>
        <div><dt className="text-xs text-muted">Reference</dt><dd className="font-mono text-xs">{ref(r.id)}</dd></div>
        <div><dt className="text-xs text-muted">{released ? "Time from request to release" : rejected ? "Time to decision" : "Open for"}</dt>
          <dd className="font-medium">{released ? gap(r.created_at, r.disbursement!.at) : rejected && r.decision ? gap(r.created_at, r.decision.at) : withdrawn ? "Withdrawn" : "In progress"}</dd></div>
      </dl>
      <ol aria-label="Request progress" className="flex flex-col gap-4 sm:flex-row">
        <Step n={1} state="done" title="Requested">
          <p>{requester}</p><p>{wat(r.created_at)}</p>
        </Step>
        <Step n={2} state={stepTwo} title={withdrawn ? "Withdrawn" : rejected ? "Rejected" : approved ? "Approved" : r.status === "UNDER_REVIEW" ? "Under review" : "Awaiting Finance"}>
          {withdrawn ? <><p>{requester}</p><p>{wat(r.updated_at)} · after {gap(r.created_at, r.updated_at)}</p><p>Withdrawn by the requester before a decision</p></> : r.decision ? (<><p>{deciderName}</p><p>{wat(r.decision.at)} · after {gap(r.created_at, r.decision.at)}</p>{r.decision.reason ? <p>“{r.decision.reason}”</p> : null}</>) : <p>Finance has not decided yet</p>}
        </Step>
        <Step n={3} state={stepThree} title={released ? "Released" : rejected || withdrawn ? "Not released" : approved ? "Awaiting release" : "Release"} last>
          {r.disbursement ? (<><p>{r.disbursement.by ?? HIDDEN}</p><p>{wat(r.disbursement.at)}{r.decision ? ` · after ${gap(r.decision.at, r.disbursement.at)}` : ""}</p><p>Reference {r.disbursement.reference}</p></>)
            : withdrawn ? <p>The request was withdrawn</p> : rejected ? <p>The request was turned down{r.resubmitted_as ? "; a revised request was raised" : ""}</p> : approved ? <p>Approved; the money has not been released</p> : <p>After approval</p>}
        </Step>
      </ol>
    </div>
  );
}
