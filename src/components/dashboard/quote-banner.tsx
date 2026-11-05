import { QuoteSlide } from "@/components/quote-slide";
import type { PublishedQuote } from "@/lib/data/governance";

/** The week's published quote (approved by a second person), as a slide. Renders nothing when none is published. */
export function QuoteBanner({ quote, session }: { quote: PublishedQuote | null; session?: string }) {
  if (!quote) return null;
  return <section aria-label="Quote of the week"><QuoteSlide quote={quote.quote} speaker={quote.speaker_name} businessUnit={quote.business_unit} session={session} /></section>;
}
