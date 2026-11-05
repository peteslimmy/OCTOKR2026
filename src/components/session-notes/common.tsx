"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { Badge, type Tone } from "@/components/ui/primitives";
import { markdownToHtml } from "@/lib/session-notes/markdown";
import { actionStatusLabel, decisionStatusLabel, linkTypeLabel, minutesStatusLabel, sessionStatusLabel, visibilityLabel } from "@/lib/session-notes/constants";
import type { LinkRef, Person } from "@/lib/session-notes/types";
import { apiRequest } from "@/components/ui/client";

/** A note, rendered. The only way markdown becomes HTML in this module is lib/session-notes/markdown.ts (every typed character escaped, a fixed set of tags). */
export function RichText({ md, className }: { md: string; className?: string }) {
  return <div className={clsx("session-rich", className)} dangerouslySetInnerHTML={{ __html: markdownToHtml(md) }} />;
}

/** A fresh request key for one deliberate user act (so a retried or double-clicked request is recognised by the server). */
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

const sessionTone: Record<string, Tone> = { DRAFT: "undefined", IN_PROGRESS: "info", COMPLETED: "done", ARCHIVED: "locked" };
const decisionTone: Record<string, Tone> = { PROPOSED: "warn", APPROVED: "done", REJECTED: "notdone", SUPERSEDED: "locked", WITHDRAWN: "locked" };
const actionTone: Record<string, Tone> = { OPEN: "info", IN_PROGRESS: "info", BLOCKED: "critical", COMPLETED: "done", CANCELLED: "locked" };
const sevTone: Record<string, Tone> = { LOW: "undefined", MEDIUM: "info", HIGH: "warn", CRITICAL: "critical" };
const minutesTone: Record<string, Tone> = { DRAFT: "undefined", SUBMITTED: "warn", REVIEWED: "info", FINALISED: "done" };

export const SessionStatusBadge = ({ status }: { status: string }) => <Badge tone={sessionTone[status] ?? "undefined"}>{sessionStatusLabel[status] ?? status}</Badge>;
export const DecisionStatusBadge = ({ status }: { status: string }) => <Badge tone={decisionTone[status] ?? "undefined"}>{decisionStatusLabel[status] ?? status}</Badge>;
export const ActionStatusBadge = ({ status }: { status: string }) => <Badge tone={actionTone[status] ?? "undefined"}>{actionStatusLabel[status] ?? status}</Badge>;
export const SeverityBadge = ({ severity }: { severity: string }) => <Badge tone={sevTone[severity] ?? "undefined"}>{severity.charAt(0) + severity.slice(1).toLowerCase()}</Badge>;
export const MinutesStatusBadge = ({ status }: { status: string }) => <Badge tone={minutesTone[status] ?? "undefined"}>{minutesStatusLabel[status] ?? status}</Badge>;
export const VisibilityBadge = ({ visibility }: { visibility: string }) => (visibility === "SHARED" ? null : <Badge tone="locked" title={visibilityLabel(visibility)}>{visibility === "MANAGEMENT" ? "Management only" : "Confidential"}</Badge>);

export function LinkChips({ links, onRemove }: { links: LinkRef[]; onRemove?: (l: LinkRef) => void }) {
  if (!links.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Linked OKR components">
      {links.map((l) => (
        <li key={l.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink" title={`${linkTypeLabel(l.target_type)}: ${l.label}`}>
          <span className="text-muted">{linkTypeLabel(l.target_type)}</span> <span className="max-w-[18rem] truncate">{l.label}</span>
          {onRemove ? <button type="button" aria-label={`Remove link to ${l.label}`} onClick={() => onRemove(l)} className="ml-0.5 rounded px-1 text-muted hover:bg-line hover:text-ink">×</button> : null}
        </li>
      ))}
    </ul>
  );
}

/** The people who can be invited, assigned or made owners (loaded once; names and unit only). */
export function usePeople(): { people: Person[]; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ people: Person[]; loading: boolean; failed: boolean }>({ people: [], loading: true, failed: false });
  useEffect(() => {
    let live = true;
    apiRequest<Person[]>("GET", "okr-people").then((p) => live && setState({ people: p, loading: false, failed: false })).catch(() => live && setState({ people: [], loading: false, failed: true }));
    return () => { live = false; };
  }, []);
  return state;
}

export const dateText = (d: string | null | undefined) => (d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(d.length === 10 ? `${d}T12:00:00+01:00` : d)) : "—");
export const dateTimeText = (d: string | null | undefined) => (d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }).format(new Date(d)) : "—");
