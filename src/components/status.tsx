import { CheckCircle2, CircleDashed, Lock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { formatPercent } from "@/lib/format";

// Status semantics (14-DESIGN-SYSTEM): never colour alone, always an icon + text label.
export function TaskStatusBadge({ status }: { status: "UNDEFINED" | "DONE" | "NOT_DONE" }) {
  if (status === "DONE") return <Badge tone="done"><CheckCircle2 className="h-3 w-3" aria-hidden />Done</Badge>;
  if (status === "NOT_DONE") return <Badge tone="notdone"><XCircle className="h-3 w-3" aria-hidden />Not done</Badge>;
  return <Badge tone="undefined"><CircleDashed className="h-3 w-3" aria-hidden />Undefined</Badge>;
}

export function GoalStatusBadge({ status, pending }: { status: "DONE" | "NOT_DONE"; pending: boolean }) {
  if (status === "DONE") return <Badge tone="done"><CheckCircle2 className="h-3 w-3" aria-hidden />Goal done</Badge>;
  if (pending) return <Badge tone="undefined"><CircleDashed className="h-3 w-3" aria-hidden />In progress</Badge>;
  return <Badge tone="notdone"><XCircle className="h-3 w-3" aria-hidden />Goal not done</Badge>;
}

export function PhaseBadge({ phase }: { phase: string }) {
  switch (phase) {
    case "OPEN": return <Badge tone="info">Open for editing</Badge>;
    case "LATE_OPEN": return <Badge tone="warn">Late report · authorised</Badge>;
    case "CONTENT_LOCKED": return <Badge tone="locked"><Lock className="h-3 w-3" aria-hidden />Content locked</Badge>;
    case "FINAL_LOCKED": return <Badge tone="locked"><Lock className="h-3 w-3" aria-hidden />Final locked</Badge>;
    default: return <Badge tone="undefined">Not open yet</Badge>;
  }
}

export function SubmissionBadge({ status }: { status: string }) {
  return status === "SUBMITTED" ? <Badge tone="done">Submitted</Badge> : <Badge tone="warn">Not submitted</Badge>;
}

export function ComplianceBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return status === "COMPLIANT" ? <Badge tone="done">Compliant</Badge> : <Badge tone="critical">Non-compliant</Badge>;
}

export function ScoreText({ value, className }: { value: number | string | null | undefined; className?: string }) {
  return <span className={className ?? "tabular-nums"}>{formatPercent(value)}</span>;
}

export const wat = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) =>
  new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "Africa/Lagos" }).format(new Date(iso)) + " WAT";
export const watDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
