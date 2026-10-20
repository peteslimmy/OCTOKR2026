import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./primitives";
import { AnimatedNumber } from "./animated-number";
import type { MetricKind } from "@/lib/format";

/**
 * One headline figure with its meaning attached: a label, the value, an optional note, an optional plain-language definition that
 * opens in place (keyboard and screen-reader friendly), and an optional link to the records behind the number.
 * `value` is a number (counted up on first view, formatted by `kind`) or ready-made text for figures that are not numbers.
 */
export function MetricCard({ label, value, kind = "count", note, definition, href, hrefLabel, children }: {
  label: string; value: number | string | null; kind?: MetricKind; note?: ReactNode; definition?: string; href?: string; hrefLabel?: string; children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">
        {typeof value === "number" ? <AnimatedNumber value={value} kind={kind} /> : (value ?? "—")}
      </p>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      {children}
      {definition ? (
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer text-brand-700 underline">What does this mean?<span className="sr-only"> ({label})</span></summary>
          <p className="mt-1">{definition}</p>
        </details>
      ) : null}
      {href ? <Link href={href} className="mt-1 inline-block text-sm text-brand-700 underline">{hrefLabel ?? "See the records"}<span className="sr-only"> for {label}</span></Link> : null}
    </Card>
  );
}
