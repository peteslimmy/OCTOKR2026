"use client";

import Link from "next/link";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { apiRequest, useAction } from "@/components/ui/client";
import type { QuoteTurn } from "@/lib/data/quote-rota";
import { QuotePresenter } from "./quote-presenter";

/**
 * "Quote review": the quote(s) to be given in this session, from the rota HR set. A quote moved here from a skipped session is labelled. The Presenter (or the Super Admin)
 * puts it on the whole screen and then marks it presented. A unit that has not yet entered its quote shows as waiting.
 */
export function QuoteReview({ turns, weekLabel, session, canAssign }: { turns: QuoteTurn[]; weekLabel: string; session: string; canAssign: boolean }) {
  const { run, pending } = useAction();
  return (
    <Card data-testid="quote-review">
      <CardHeader title="Quote review" description={`The quote for the ${weekLabel} session.`}
        action={canAssign ? <Link className="text-sm font-medium text-brand-700 underline" href="/quote">Open the quote rota</Link> : undefined} />
      {turns.length === 0 ? <EmptyState title="No unit has been chosen for this session">HR chooses the unit that gives the quote under Weekly quote.</EmptyState> : (
        <ul className="divide-y divide-line">
          {turns.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">{t.business_unit_name}
                  {t.carried ? <Badge tone="warn" title="Its own session was skipped">{`Moved from week ${t.week_number}`}</Badge> : null}
                  {t.status === "PRESENTED" ? <Badge tone="done">Presented</Badge> : t.status === "SUBMITTED" ? <Badge tone="done">Ready</Badge> : <Badge tone="warn">Waiting for {t.business_unit_name}</Badge>}
                </p>
                {t.quote ? <blockquote className="mt-2 border-l-4 border-brand-200 pl-3 text-ink">“{t.quote}”<footer className="mt-1 text-sm text-muted">{t.speaker_name}{t.submitted_for_unit ? " · entered by an administrator" : ""}</footer></blockquote>
                  : <p className="mt-2 text-sm text-muted">The unit has not entered its quote yet.</p>}
              </div>
              {t.quote && t.speaker_name ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <QuotePresenter quote={t.quote} speaker={t.speaker_name} businessUnit={t.business_unit_name} session={session} previous={null} next={null} />
                  {t.status !== "PRESENTED" ? <Button variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", `quote-turns/${t.id}`, { action: "present" }), { success: "Marked as presented." })}>Mark presented</Button> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
