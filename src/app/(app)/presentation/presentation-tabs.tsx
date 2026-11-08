import Link from "next/link";

export type PresentationView = "units" | "quote";

/**
 * The two parts of Presentation mode, as real links (so a tab can be bookmarked and the browser's back button works):
 * the business units' reports, and the Quote review. The quote has its own tab so it never sits on top of the reports being presented.
 */
export function PresentationTabs({ weekId, active, showQuote }: { weekId: string; active: PresentationView; showQuote: boolean }) {
  if (!showQuote) return null;
  const tab = (view: PresentationView, label: string, testId: string) => {
    const selected = view === active;
    return (
      <Link key={view} role="tab" data-testid={testId} aria-selected={selected} aria-current={selected ? "page" : undefined}
        href={view === "units" ? `/presentation?week=${weekId}` : `/presentation?week=${weekId}&view=quote`}
        className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${selected ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink"}`}>
        {label}
      </Link>
    );
  };
  return (
    <div role="tablist" aria-label="Presentation sections" className="mb-4 flex gap-1 border-b border-line">
      {tab("units", "Business units", "presentation-tab-units")}
      {tab("quote", "Quote review", "presentation-tab-quote")}
    </div>
  );
}
