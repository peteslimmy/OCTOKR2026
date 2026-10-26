import { Card, CardHeader } from "@/components/ui/primitives";
import type { PublishedQuote } from "@/lib/data/governance";

/** The week's published quote (approved by a second person). Renders nothing when none is published. */
export function QuoteBanner({ quote }: { quote: PublishedQuote | null }) {
  if (!quote) return null;
  return (
    <Card>
      <CardHeader title="Quote of the week" />
      <div className="px-6 py-4">
        <blockquote className="border-l-4 border-brand-600 pl-4">
          <p className="italic">“{quote.quote}”</p>
          <cite className="mt-2 block text-xs not-italic text-muted">{quote.speaker_name} · {quote.business_unit}</cite>
        </blockquote>
      </div>
    </Card>
  );
}
