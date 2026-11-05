"use client";

import Link from "next/link";
import { Badge, type Tone } from "@/components/ui/primitives";
import { awaitingLabel, linkTypeLabel, moduleLabel, priorityLabel, statusLabel } from "@/lib/executive-oversight/constants";
import type { EoLink } from "@/lib/executive-oversight/types";

export { RichText, newKey, dateText, dateTimeText } from "@/components/session-notes/common";

const priorityTone: Record<string, Tone> = { LOW: "undefined", NORMAL: "info", HIGH: "warn", CRITICAL: "critical" };
const statusTone: Record<string, Tone> = {
  DRAFT: "undefined", SUBMITTED: "warn", ACKNOWLEDGED: "info", RESPONSE_REQUESTED: "warn", RESPONSE_SUBMITTED: "info", UNDER_CONSIDERATION: "info", ACCEPTED_FOR_ACTION: "done", PARTIALLY_ACCEPTED: "done",
  NOT_ACCEPTED: "notdone", IMPLEMENTATION_IN_PROGRESS: "info", IMPLEMENTATION_REPORTED: "done", CLOSED: "locked", WITHDRAWN: "locked",
};

export const PriorityBadge = ({ priority }: { priority: string }) => <Badge tone={priorityTone[priority] ?? "undefined"}>{priorityLabel[priority] ?? priority}</Badge>;
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={statusTone[status] ?? "undefined"}>{statusLabel[status] ?? status}</Badge>;
export const AwaitingBadge = ({ awaiting }: { awaiting: string | null }) => (awaiting ? <Badge tone={awaiting === "BU" ? "warn" : "brand"}>{awaitingLabel[awaiting]}</Badge> : null);
export const OverdueBadge = ({ overdue }: { overdue: boolean }) => (overdue ? <Badge tone="critical">Response overdue</Badge> : null);
/** Comments and recommendations are visibly different records. */
export const KindBadge = ({ kind }: { kind: "COMMENT" | "RECOMMENDATION" }) => <Badge tone={kind === "COMMENT" ? "undefined" : "brand"} variant="outline">{kind === "COMMENT" ? "Comment" : "Recommendation"}</Badge>;
export const ModuleText = ({ module }: { module: string }) => <span className="text-muted">{moduleLabel(module)}</span>;

export function Links({ links }: { links: EoLink[] }) {
  if (!links.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Linked records">
      {links.map((l) => (
        <li key={l.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink" title={`${linkTypeLabel(l.target_type)}: ${l.label}`}>
          <span className="text-muted">{linkTypeLabel(l.target_type)}</span> <span className="max-w-[18rem] truncate">{l.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Where a linked record can be opened, if it has a page (the destination checks access itself). */
export function linkHref(t: string, id: string): string | null {
  if (t === "SESSION") return `/session-notes/${id}`;
  return null;
}

export const RecLink = ({ id, children }: { id: string; children: React.ReactNode }) => <Link className="font-medium text-brand-700 underline" href={`/executive-oversight/recommendations/${id}`}>{children}</Link>;
export const CommentLink = ({ id, children }: { id: string; children: React.ReactNode }) => <Link className="font-medium text-brand-700 underline" href={`/executive-oversight/comments/${id}`}>{children}</Link>;
