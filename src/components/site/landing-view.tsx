"use client";

import clsx from "clsx";
import { Check, ChevronRight, Quote } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced";
import type { LandingConfig, SiteSection } from "@/lib/site-content";
import { DashboardArt } from "./art";
import { ICONS } from "./icons";
import { BrandLogo } from "@/components/brand-logo";

const Hero3D = dynamic(() => import("./hero3d"), { ssr: false, loading: () => <div className="shimmer aspect-[16/11] w-full rounded-2xl" aria-hidden /> });

export interface SiteBrand { name: string; shortName: string; logoUrl: string | null; primaryColor: string; logoHeight?: number }
export const imageUrl = (slot: string | null | undefined, images: Record<string, number>) => (slot ? `/site-image/${slot}?v=${images[slot] ?? 0}` : null);

/** A link that works on the live page and is inert inside the editor preview. */
function A({ href, className, preview, children }: { href: string; className?: string; preview?: boolean; children: ReactNode }) {
  if (preview) return <span className={className} role="link" aria-disabled>{children}</span>;
  if (href.startsWith("/")) return <Link href={href} className={className}>{children}</Link>;
  return <a href={href} className={className} {...(href.startsWith("https://") ? { rel: "noopener noreferrer" } : {})}>{children}</a>;
}

const SIZE = { md: "text-3xl sm:text-4xl", lg: "text-4xl sm:text-5xl", xl: "text-5xl sm:text-6xl" } as const;
const TONE = {
  brand: { bg: "bg-brand-800", text: "text-white", sub: "text-white/85", eyebrow: "bg-white/15 text-white", primary: "bg-white text-brand-800 hover:bg-brand-50", secondary: "border border-white/60 text-white hover:bg-white/10" },
  dark: { bg: "bg-slate-900", text: "text-white", sub: "text-white/80", eyebrow: "bg-white/10 text-white", primary: "bg-white text-slate-900 hover:bg-slate-100", secondary: "border border-white/50 text-white hover:bg-white/10" },
  light: { bg: "bg-white", text: "text-ink", sub: "text-muted", eyebrow: "bg-brand-100 text-brand-800", primary: "bg-brand-700 text-white hover:bg-brand-800", secondary: "border border-line text-ink hover:bg-surface" },
} as const;

export function LandingView({ config, brand, images, preview = false }: { config: LandingConfig; brand: SiteBrand; images: Record<string, number>; preview?: boolean }) {
  const reduce = usePrefersReducedMotion();
  const { header, hero, footer } = config;
  const tone = TONE[hero.tone];
  const heroImage = imageUrl(hero.imageSlot, images);
  const centered = hero.layout === "centered" || hero.align === "center";
  const bgImage = hero.layout === "background" ? heroImage : null;
  const visual = (() => {
    if (hero.visual === "none" || hero.layout === "background") return null;
    if (hero.visual === "image") return heroImage
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={heroImage} alt={hero.imageAlt} className="w-full rounded-2xl border border-white/20 object-cover shadow-2xl" />
      : <DashboardArt className="w-full drop-shadow-2xl" />;
    if (hero.visual === "3d") return <Hero3D color={brand.primaryColor} reduceMotion={reduce} />;
    return <DashboardArt className="w-full drop-shadow-2xl" />;
  })();

  return (
    <div className="min-h-full bg-surface text-ink">
      {/* ---------------------------------------------------------------- header */}
      <header className={clsx("z-30 border-b border-line bg-white", header.sticky && !preview && "sticky top-0")}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="inline-flex flex-col items-start gap-1 font-semibold leading-tight tracking-tight">
            {brand.logoUrl
              ? <BrandLogo src={brand.logoUrl} height={brand.logoHeight} />
              : <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 font-bold text-white" aria-hidden>{brand.shortName}</span>}
            {brand.name}
          </span>
          <nav aria-label="Page" className="flex items-center gap-1 sm:gap-2">
            {header.showNav ? header.links.map((l) => <A key={l.label} href={l.href} preview={preview} className="hidden rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-surface md:inline-block">{l.label}</A>) : null}
            <A href="/login" preview={preview} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">{header.signInLabel}</A>
          </nav>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------------- hero */}
        <section className={clsx("relative overflow-hidden", tone.bg, tone.text)} aria-labelledby="hero-title">
          {bgImage
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={bgImage} alt={hero.imageAlt} className="absolute inset-0 h-full w-full object-cover" />
            : null}
          {bgImage ? <div className="absolute inset-0 bg-black" style={{ opacity: hero.overlay / 100 }} aria-hidden /> : null}
          <div className={clsx("relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24", hero.layout === "split" && visual ? "grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center" : "")}>
            <Reveal className={clsx("space-y-6", centered && "mx-auto max-w-3xl text-center")}>
              {hero.eyebrow ? <p className={clsx("inline-block rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase", tone.eyebrow)}>{hero.eyebrow}</p> : null}
              <h1 id="hero-title" className={clsx("leading-[1.08] font-semibold tracking-tight text-balance", SIZE[hero.size])}>{hero.headline}</h1>
              {hero.subheadline ? <p className={clsx("text-lg", tone.sub, centered ? "mx-auto max-w-2xl" : "max-w-xl")}>{hero.subheadline}</p> : null}
              <div className={clsx("flex flex-wrap gap-3", centered && "justify-center")}>
                {hero.primary.label ? <A href={hero.primary.href} preview={preview} className={clsx("inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 py-2 text-sm font-semibold", tone.primary)}>{hero.primary.label}<ChevronRight className="h-4 w-4" aria-hidden /></A> : null}
                {hero.secondary.show && hero.secondary.label ? <A href={hero.secondary.href} preview={preview} className={clsx("inline-flex min-h-12 items-center justify-center rounded-xl px-6 py-2 text-sm font-semibold", tone.secondary)}>{hero.secondary.label}</A> : null}
              </div>
              {hero.showCalendarCard && hero.layout === "split" ? (
                <dl className="max-w-md space-y-2 rounded-2xl border border-white/25 bg-white/10 p-5 text-sm">
                  <div className="flex justify-between gap-4 border-b border-white/20 pb-2"><dt className="opacity-80">Week starts</dt><dd className="font-medium">Monday 00:00</dd></div>
                  <div className="flex justify-between gap-4"><dt className="opacity-80">Time zone</dt><dd className="font-medium">Africa/Lagos</dd></div>
                </dl>
              ) : null}
            </Reveal>
            {visual && hero.layout === "split" ? <Reveal delay={0.1}>{visual}</Reveal> : null}
            {visual && hero.layout === "centered" ? <Reveal delay={0.1} className="mx-auto mt-12 max-w-4xl">{visual}</Reveal> : null}
          </div>
        </section>

        {config.sections.filter((s) => s.enabled).map((s) => <Section key={s.id} s={s} images={images} preview={preview} />)}
      </main>

      {/* ---------------------------------------------------------------- footer */}
      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <span>{footer.text}</span>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {footer.links.map((l) => <A key={l.label} href={l.href} preview={preview} className="hover:text-ink hover:underline">{l.label}</A>)}
            {footer.showSignIn ? <A href="/login" preview={preview} className="font-medium text-brand-700 underline">{header.signInLabel}</A> : null}
          </nav>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- sections
const BG = { white: "bg-white", surface: "bg-surface", brand: "bg-brand-800 text-white" } as const;
const COLS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" } as const;

function Heading({ s, dark }: { s: SiteSection; dark?: boolean }) {
  if (!s.title && !s.intro) return null;
  return (
    <div className="mb-10 max-w-2xl">
      {s.title ? <h2 id={`${s.id}-title`} className="text-3xl font-semibold tracking-tight text-balance">{s.title}</h2> : null}
      {s.intro ? <p className={clsx("mt-3 text-lg", dark ? "text-white/85" : "text-muted")}>{s.intro}</p> : null}
    </div>
  );
}

function Section({ s, images, preview }: { s: SiteSection; images: Record<string, number>; preview: boolean }) {
  const dark = s.background === "brand";
  const sectionImage = imageUrl(s.imageSlot, images);
  return (
    <section id={s.id} aria-labelledby={s.title ? `${s.id}-title` : undefined} className={clsx("scroll-mt-16", BG[s.background])}>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        {s.type === "features" ? (
          <>
            <Heading s={s} dark={dark} />
            <Stagger as="ul" className={clsx("grid gap-5", COLS[s.columns])}>
              {s.items.map((i, n) => {
                const Icon = ICONS[i.icon ?? "target"];
                return (
                  <StaggerItem as="li" key={n} className={clsx("rounded-2xl border p-6 transition-shadow hover:shadow-lg", dark ? "border-white/20 bg-white/10" : "border-line bg-white")}>
                    <span className={clsx("flex h-12 w-12 items-center justify-center rounded-xl", dark ? "bg-white text-brand-800" : "bg-brand-100 text-brand-700")}><Icon className="h-6 w-6" aria-hidden /></span>
                    <h3 className="mt-4 text-lg font-semibold">{i.title}</h3>
                    <p className={clsx("mt-1.5 text-sm leading-relaxed", dark ? "text-white/85" : "text-muted")}>{i.text}</p>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </>
        ) : null}

        {s.type === "steps" ? (
          <>
            <Heading s={s} dark={dark} />
            <Stagger as="ul" className={clsx("grid gap-8", COLS[s.columns])}>
              {s.items.map((i, n) => (
                <StaggerItem as="li" key={n} className="relative flex gap-4">
                  <span className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold", dark ? "bg-white text-brand-800" : "bg-brand-700 text-white")} aria-hidden>{n + 1}</span>
                  <div><h3 className="text-lg font-semibold">{i.title}</h3><p className={clsx("mt-1 text-sm leading-relaxed", dark ? "text-white/85" : "text-muted")}>{i.text}</p></div>
                </StaggerItem>
              ))}
            </Stagger>
          </>
        ) : null}

        {s.type === "stats" ? (
          <>
            <Heading s={s} dark={dark} />
            <Stagger as="ul" className={clsx("grid gap-px overflow-hidden rounded-2xl border", COLS[s.columns], dark ? "border-white/20 bg-white/20" : "border-line bg-line")}>
              {s.items.map((i, n) => (
                <StaggerItem as="li" key={n} className={clsx("p-8 text-center", dark ? "bg-brand-800" : "bg-white")}>
                  <p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{i.value}</p>
                  <p className={clsx("mt-2 text-sm", dark ? "text-white/85" : "text-muted")}>{i.label}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </>
        ) : null}

        {s.type === "gallery" ? (
          <>
            <Heading s={s} dark={dark} />
            {s.items.filter((i) => i.imageSlot).length === 0 ? <p className="text-sm text-muted">Add images in the editor to fill this gallery.</p> : (
              <Stagger as="ul" className={clsx("grid gap-5", COLS[s.columns])}>
                {s.items.filter((i) => i.imageSlot).map((i, n) => (
                  <StaggerItem as="li" key={n}>
                    <figure className="overflow-hidden rounded-2xl border border-line bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl(i.imageSlot, images)!} alt={i.alt ?? ""} className="aspect-[4/3] w-full object-cover" />
                      {i.caption ? <figcaption className="px-4 py-3 text-sm text-muted">{i.caption}</figcaption> : null}
                    </figure>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </>
        ) : null}

        {s.type === "quote" ? (
          <Reveal>
            <figure className="mx-auto max-w-3xl text-center">
              <Quote className={clsx("mx-auto h-9 w-9", dark ? "text-white/70" : "text-brand-700")} aria-hidden />
              <blockquote className="mt-4 text-2xl leading-snug font-medium text-balance sm:text-3xl">{s.items[0]?.text}</blockquote>
              <figcaption className="mt-6 flex items-center justify-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {sectionImage ? <img src={sectionImage} alt="" className="h-12 w-12 rounded-full object-cover" /> : null}
                <span className="text-left text-sm"><span className="block font-semibold">{s.items[0]?.author}</span><span className={dark ? "text-white/80" : "text-muted"}>{s.items[0]?.role}</span></span>
              </figcaption>
            </figure>
          </Reveal>
        ) : null}

        {s.type === "trust" ? (
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              {s.title ? <h2 id={`${s.id}-title`} className="text-3xl font-semibold tracking-tight text-balance">{s.title}</h2> : null}
              {s.intro ? <p className={clsx("mt-3 text-lg", dark ? "text-white/85" : "text-muted")}>{s.intro}</p> : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {sectionImage ? <img src={sectionImage} alt="" className="mt-6 w-full rounded-2xl border border-line object-cover" /> : null}
            </div>
            <Stagger as="ul" className="space-y-3 text-sm">
              {s.items.map((i, n) => (
                <StaggerItem as="li" key={n} className={clsx("flex gap-3 rounded-xl border px-4 py-3.5", dark ? "border-white/20 bg-white/10" : "border-line bg-white")}>
                  <span className={clsx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", dark ? "bg-white text-brand-800" : "bg-brand-700 text-white")} aria-hidden><Check className="h-3 w-3" /></span>{i.text}
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        ) : null}

        {s.type === "cta" ? (
          <Reveal className="mx-auto max-w-2xl text-center">
            {s.title ? <h2 id={`${s.id}-title`} className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{s.title}</h2> : null}
            {s.intro ? <p className={clsx("mt-3 text-lg", dark ? "text-white/85" : "text-muted")}>{s.intro}</p> : null}
            {s.button?.label ? <A href={s.button.href} preview={preview} className={clsx("mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-7 py-2 text-sm font-semibold", dark ? "bg-white text-brand-800 hover:bg-brand-50" : "bg-brand-700 text-white hover:bg-brand-800")}>{s.button.label}<ChevronRight className="h-4 w-4" aria-hidden /></A> : null}
          </Reveal>
        ) : null}

        {s.type === "text" ? (
          <div className={clsx("grid gap-10", sectionImage && "lg:grid-cols-2 lg:items-center")}>
            <Reveal>
              {s.title ? <h2 id={`${s.id}-title`} className="text-3xl font-semibold tracking-tight text-balance">{s.title}</h2> : null}
              <div className={clsx("mt-4 space-y-4 text-lg leading-relaxed", dark ? "text-white/85" : "text-muted")}>{s.intro.split(/\n+/).filter(Boolean).map((p, n) => <p key={n}>{p}</p>)}</div>
              {s.button?.label ? <A href={s.button.href} preview={preview} className={clsx("mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-6 py-2 text-sm font-semibold", dark ? "bg-white text-brand-800" : "bg-brand-700 text-white hover:bg-brand-800")}>{s.button.label}</A> : null}
            </Reveal>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {sectionImage ? <Reveal delay={0.1}><img src={sectionImage} alt="" className="w-full rounded-2xl border border-line object-cover shadow-xl" /></Reveal> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
