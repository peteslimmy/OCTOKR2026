import { Badge } from "@/components/ui/primitives";
import type { QuoteTurn } from "@/lib/data/quote-rota";

export const turnBadge = (t: QuoteTurn | null, carried?: boolean) =>
  !t ? <Badge tone="undefined">Not chosen</Badge>
    : t.status === "PRESENTED" ? <Badge tone="done">Presented</Badge>
    : t.status === "SUBMITTED" ? <Badge tone="done">{carried ? "Ready · moved here" : "Quote in"}</Badge>
    : <Badge tone="warn">{carried ? "Waiting · moved here" : "Waiting for the unit"}</Badge>;
