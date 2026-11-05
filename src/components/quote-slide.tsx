import type { CSSProperties } from "react";

export interface QuoteSlideProps {
  quote: string;
  speaker: string;
  businessUnit: string;
  /** "Week 42 · October 2026" — shown in the session pill. */
  session?: string;
  /** The neighbouring sessions' speakers, shown in the footer. */
  previous?: string | null;
  next?: string | null;
  /** "hero" fills the presenter's screen; "card" sits in a page. */
  size?: "card" | "hero";
}

const SERIF: CSSProperties = { fontFamily: '"Playfair Display", "Iowan Old Style", Georgia, "Times New Roman", serif' };
const CREAM = "#fff3e6";

/** The week's quote as a slide: warm gradient, large serif text, speaker and BU, and the neighbouring sessions. */
export function QuoteSlide({ quote, speaker, businessUnit, session, previous, next, size = "card" }: QuoteSlideProps) {
  const hero = size === "hero";
  const length = quote.length;
  // long quotes step down so they always fit
  const text = hero ? (length > 220 ? "clamp(1.4rem,3vw,2.4rem)" : length > 110 ? "clamp(1.7rem,4vw,3.2rem)" : "clamp(2rem,5vw,4.2rem)")
    : length > 220 ? "1.25rem" : length > 110 ? "1.5rem" : "1.85rem";
  return (
    <figure className={`relative isolate m-0 flex w-full flex-col overflow-hidden text-center ${hero ? "min-h-[70vh]" : "min-h-[22rem] rounded-2xl"}`}
      style={{ color: CREAM, background: "linear-gradient(160deg,#c2410c 0%,#9a3412 48%,#7c2d12 100%)" }} aria-label={`Quote of the week by ${speaker}`}>
      {/* smoke-like glows */}
      <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 -z-10 h-96 w-96 rounded-full blur-3xl" style={{ background: "radial-gradient(circle,rgba(251,146,60,.55),transparent 65%)" }} />
      <span aria-hidden className="pointer-events-none absolute -bottom-32 right-0 -z-10 h-[28rem] w-[28rem] rounded-full blur-3xl" style={{ background: "radial-gradient(circle,rgba(234,88,12,.5),transparent 65%)" }} />
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: "repeating-linear-gradient(115deg,rgba(255,255,255,.035) 0 2px,transparent 2px 22px)" }} />

      {session ? (
        <figcaption className="absolute left-4 top-4 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[.18em]" style={{ borderColor: "rgba(255,243,230,.45)", background: "rgba(60,15,3,.45)" }}>
          Session · {session}
        </figcaption>
      ) : null}

      <div className={`flex flex-1 flex-col items-center justify-center px-8 ${hero ? "py-20" : "py-14"}`}>
        <p className="mb-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[.3em]" style={{ color: CREAM }}>
          <span aria-hidden className="h-px w-10" style={{ background: "#f6c667" }} />Quote of the week<span aria-hidden className="h-px w-10" style={{ background: "#f6c667" }} />
        </p>
        <blockquote className="m-0 max-w-3xl">
          <p className="m-0 font-medium leading-[1.25]" style={{ ...SERIF, fontSize: text, textShadow: "0 2px 18px rgba(60,15,3,.45)" }}>“{quote}”</p>
        </blockquote>
        <span aria-hidden className="my-6 text-lg" style={{ color: "#f6c667" }}>✦</span>
        <cite className="not-italic">
          <span className="block text-sm font-semibold uppercase tracking-[.25em]">{speaker}</span>
          <span className="mt-1.5 block text-sm font-semibold">BU: {businessUnit}</span>
        </cite>
      </div>

      <div className="flex items-center justify-between gap-4 px-5 py-3 text-left text-xs" style={{ background: "rgba(60,15,3,.62)" }}>
        <p className="m-0 min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-[.2em]">‹ Previous session</span><span className="block truncate">{previous ?? "—"}</span></p>
        <span aria-hidden className="h-1 w-8 shrink-0 rounded-full" style={{ background: "#f6c667" }} />
        <p className="m-0 min-w-0 text-right"><span className="block text-[10px] font-semibold uppercase tracking-[.2em]">Next session ›</span><span className="block truncate">{next ?? "—"}</span></p>
      </div>
    </figure>
  );
}
