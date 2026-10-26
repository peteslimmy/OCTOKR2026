"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Button, Field, Input } from "@/components/ui/primitives";
import { brandShades, contrastWithWhite, DEFAULT_PRIMARY, MIN_CONTRAST } from "@/lib/branding-theme";
import { BrandLogo, LOGO_DEFAULT_HEIGHT, LOGO_MAX_HEIGHT, LOGO_MIN_HEIGHT } from "@/components/brand-logo";

interface Initial { appName: string; shortName: string; primaryColor: string; logoUrl: string | null; faviconUrl: string | null; logoHeight: number }

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("The file could not be read."));
  r.readAsDataURL(file);
});

export function BrandingForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [f, setF] = useState({ appName: initial.appName, shortName: initial.shortName, primaryColor: initial.primaryColor, logoHeight: initial.logoHeight || LOGO_DEFAULT_HEIGHT });
  const contrast = contrastWithWhite(f.primaryColor);
  const shades = brandShades(f.primaryColor);
  const readable = contrast >= MIN_CONTRAST;

  const upload = async (kind: "logo" | "favicon", file: File | undefined) => {
    if (!file) return;
    const ok = await run(async () => apiRequest("PUT", `branding/assets/${kind}`, { mime: file.type === "image/x-icon" || file.name.endsWith(".ico") ? "image/x-icon" : file.type, data: await toBase64(file) }),
      { success: kind === "logo" ? "Logo updated." : "Favicon updated." });
    if (ok) router.refresh();
  };
  const remove = async (kind: "logo" | "favicon") => { if (await run(() => apiRequest("DELETE", `branding/assets/${kind}`), { success: "Image removed." })) router.refresh(); };

  return (
    <div className="grid gap-8 px-6 py-5 lg:grid-cols-2">
      <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => apiRequest("PUT", "branding", f), { success: "Branding saved." })) router.refresh(); }}>
        <Field id="br-name" label="Application name" hint="Shown in the header, the browser tab and emails."><Input value={f.appName} maxLength={60} required onChange={(e) => setF({ ...f, appName: e.target.value })} /></Field>
        <Field id="br-short" label="Short mark" hint="1 to 3 characters, shown in place of the logo when none is uploaded."><Input value={f.shortName} maxLength={3} required onChange={(e) => setF({ ...f, shortName: e.target.value })} /></Field>
        <div>
          <label htmlFor="br-color" className="mb-1 block text-sm font-medium">Main colour</label>
          <div className="flex items-center gap-3">
            <input id="br-color" type="color" value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} className="h-10 w-14 cursor-pointer rounded border border-line bg-panel" />
            <span className="font-mono text-sm">{f.primaryColor}</span>
            <Button variant="secondary" size="sm" onClick={() => setF({ ...f, primaryColor: DEFAULT_PRIMARY })}>Reset</Button>
          </div>
          <p className={`mt-1 text-xs ${readable ? "text-muted" : "text-[var(--critical-fg)]"}`} role={readable ? undefined : "alert"}>
            {readable ? `Contrast with white text: ${contrast.toFixed(1)}:1 — readable.` : `Contrast with white text: ${contrast.toFixed(1)}:1 — too light. Buttons would be hard to read; choose a darker colour.`}
          </p>
        </div>
        {initial.logoUrl ? (
          <div>
            <label htmlFor="br-logo-size" className="mb-1 block text-sm font-medium">Logo size</label>
            <div className="flex items-center gap-3">
              <input id="br-logo-size" type="range" min={LOGO_MIN_HEIGHT} max={LOGO_MAX_HEIGHT} step={2} value={f.logoHeight} aria-valuetext={`${f.logoHeight} pixels tall`}
                onChange={(e) => setF({ ...f, logoHeight: Number(e.target.value) })} className="w-48 accent-[var(--brand-700)]" />
              <span className="w-16 text-sm tabular-nums">{f.logoHeight} px</span>
              <Button variant="secondary" size="sm" onClick={() => setF({ ...f, logoHeight: LOGO_DEFAULT_HEIGHT })}>Reset</Button>
            </div>
            <p className="mt-1 text-xs text-muted">How tall the logo appears in the header, on the sign-in page and on the landing page. The width follows the picture, so any shape works.</p>
          </div>
        ) : null}
        <Button type="submit" disabled={pending || !readable}>{pending ? "Saving…" : "Save branding"}</Button>
      </form>

      <div className="space-y-6">
        <div>
          <p className="mb-2 text-sm font-medium">Preview</p>
          <div className="rounded-lg border border-line p-4">
            <div className="flex items-center gap-2 font-semibold">
              {initial.logoUrl
                ? <BrandLogo src={initial.logoUrl} height={f.logoHeight} />
                : <span className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: shades["700"] }} aria-hidden>{f.shortName}</span>}
              {f.appName}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: shades["700"] }}>Primary button</span>
              <span className="rounded-lg px-3 py-1.5 text-sm font-medium" style={{ background: shades["100"], color: shades["800"] }}>Selected item</span>
              <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: shades["50"], color: shades["800"] }}>Q4 2026</span>
            </div>
          </div>
        </div>
        {(["logo", "favicon"] as const).map((kind) => {
          const url = kind === "logo" ? initial.logoUrl : initial.faviconUrl;
          return (
            <div key={kind}>
              <label htmlFor={`br-${kind}`} className="mb-1 block text-sm font-medium">{kind === "logo" ? "Logo" : "Favicon"}</label>
              <div className="flex items-center gap-3">
                {url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={url} alt={`Current ${kind}`} className={kind === "logo" ? "h-12 w-auto max-w-40 rounded border border-line object-contain" : "h-12 w-12 rounded border border-line object-contain"} />
                  : <span className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-line text-xs text-muted">None</span>}
                <input id={`br-${kind}`} type="file" accept={kind === "logo" ? "image/png,image/jpeg,image/webp" : "image/png,image/x-icon,.ico"} disabled={pending}
                  onChange={(e) => { void upload(kind, e.target.files?.[0]); e.target.value = ""; }} className="text-sm" />
                {url ? <Button variant="secondary" size="sm" onClick={() => remove(kind)} disabled={pending}>Remove</Button> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
