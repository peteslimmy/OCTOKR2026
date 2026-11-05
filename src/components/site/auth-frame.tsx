import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LoginConfig } from "@/lib/site-content";
import { DashboardArt } from "./art";
import { ICONS } from "./icons";
import type { SiteBrand } from "./landing-view";
import { BrandLogo } from "@/components/brand-logo";

const imageUrl = (slot: string | null, images: Record<string, number>) => (slot ? `/site-image/${slot}?v=${images[slot] ?? 0}` : null);
const TONE = {
  brand: { bg: "bg-brand-800", text: "text-white", sub: "text-white/90", mark: "bg-white text-brand-800" },
  dark: { bg: "bg-slate-900", text: "text-white", sub: "text-white/85", mark: "bg-white text-slate-900" },
  light: { bg: "bg-white", text: "text-ink", sub: "text-muted", mark: "bg-brand-700 text-white" },
} as const;

/**
 * The frame around sign-in, forgot-password and reset-password. Which layout, wording, points and picture it uses comes from
 * Administration → Landing & sign-in. On phones only the form is shown (with a small mark above it).
 */
export function AuthFrame({ login, brand, images, children, preview = false }: { login: LoginConfig; brand: SiteBrand; images: Record<string, number>; children: ReactNode; preview?: boolean }) {
  const { layout, panel } = login;
  const tone = TONE[panel.tone];
  const img = panel.showImage ? imageUrl(panel.imageSlot, images) : null;
  const logo = (
    <span className="inline-flex w-fit flex-col items-start gap-2 font-semibold tracking-tight">
      {brand.logoUrl
        ? <BrandLogo src={brand.logoUrl} height={Math.round((brand.logoHeight ?? 32) * 1.25)} onDark={login.panel.tone === "brand"} />
        : <span className={clsx("flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold", tone.mark)} aria-hidden>{brand.shortName}</span>}
      {brand.name}
    </span>
  );
  const content = (
    <div className={clsx("relative z-10 flex h-full flex-col justify-between gap-10 p-10", tone.text)}>
      {panel.showLogo ? (preview ? logo : <Link href="/" className="w-fit rounded-lg">{logo}</Link>) : <span />}
      <div className="max-w-md space-y-6">
        {panel.showArt && !img ? <DashboardArt className="w-full max-w-sm rounded-2xl opacity-95 shadow-2xl" /> : null}
        {panel.headline ? <p className="text-3xl leading-tight font-semibold tracking-tight text-balance">{panel.headline}</p> : null}
        {panel.points.length > 0 ? (
          <ul className="space-y-4">
            {panel.points.map((p, n) => {
              const Icon = ICONS[p.icon];
              return <li key={n} className={clsx("flex items-start gap-3 text-sm", tone.sub)}><Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /><span>{p.text}</span></li>;
            })}
          </ul>
        ) : null}
      </div>
      <p className={clsx("text-xs", tone.sub)}>{panel.footerText}</p>
    </div>
  );
  const backdrop = (
    <>
      {img
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={img} alt={panel.imageAlt} className="absolute inset-0 h-full w-full object-cover" />
        : null}
      {img ? <div className="absolute inset-0 bg-black" style={{ opacity: panel.overlay / 100 }} aria-hidden /> : <><span className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10" aria-hidden /><span className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-white/5" aria-hidden /></>}
    </>
  );

  if (layout === "centered") {
    return (
      <div className={clsx("flex min-h-screen flex-col items-center justify-center gap-8 bg-surface p-4 sm:p-8", preview && "min-h-0 py-10")}>
        {panel.showLogo ? <span className="text-ink">{logo}</span> : null}
        <main className="flex w-full justify-center">{children}</main>
        {panel.footerText ? <p className="text-xs text-muted">{panel.footerText}</p> : null}
      </div>
    );
  }

  if (layout === "background") {
    return (
      <div className={clsx("relative min-h-screen overflow-hidden", tone.bg, preview && "min-h-0")}>
        {backdrop}
        <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-10 sm:px-8 lg:grid-cols-2" style={preview ? { minHeight: 0 } : undefined}>
          <div className="hidden lg:block [&>div]:p-0">{content}</div>
          <main className="flex justify-center lg:justify-end"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8">{children}</div></main>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx("grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]", preview && "min-h-0")}>
      <aside className={clsx("relative hidden overflow-hidden lg:block", tone.bg, layout === "split-right" && "lg:order-2")} aria-label={`About ${brand.name}`}>
        {backdrop}
        {content}
      </aside>
      <main className="flex items-center justify-center bg-white p-4 sm:p-8">{children}</main>
    </div>
  );
}
