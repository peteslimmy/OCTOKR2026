"use client";

import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Button, Input, Select } from "@/components/ui/primitives";
import { ICON_LABELS } from "@/components/site/icons";
import { ICON_NAMES, IMAGE_LIMIT_BYTES, newSlot, type IconName } from "@/lib/site-content";

/** A labelled text box. */
export function TextField({ label, value, onChange, hint, max, multiline, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: string; max?: number; multiline?: boolean; placeholder?: string }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {multiline
        ? <textarea id={id} rows={3} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm placeholder:text-muted" />
        : <Input id={id} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function SelectField<T extends string | number>({ label, value, onChange, options, hint }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; hint?: string }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <Select id={id} value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value); }}>{options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}</Select>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand-700)]" />
      <label htmlFor={id} className="text-sm"><span className="font-medium">{label}</span>{hint ? <span className="block text-xs text-muted">{hint}</span> : null}</label>
    </div>
  );
}

export function SliderField({ label, value, onChange, min = 0, max = 100, suffix = "%", hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string; hint?: string }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 flex justify-between text-sm font-medium"><span>{label}</span><span className="tabular-nums text-muted">{value}{suffix}</span></label>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--brand-700)]" />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function IconField({ label, value, onChange }: { label: string; value: IconName; onChange: (v: IconName) => void }) {
  return <SelectField label={label} value={value} onChange={onChange} options={ICON_NAMES.map((n) => ({ value: n, label: ICON_LABELS[n] }))} />;
}

/** A bordered group with a heading. Opens and closes, so a long editor stays easy to scan. */
export function Group({ title, summary, children, defaultOpen = false, actions }: { title: string; summary?: string; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-line bg-panel">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span><span className="text-sm font-semibold">{title}</span>{summary ? <span className="ml-2 text-xs text-muted">{summary}</span> : null}</span>
        <span className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>{actions}<span className="text-muted transition-transform group-open:rotate-90" aria-hidden>›</span></span>
      </summary>
      <div className="space-y-4 border-t border-line p-4">{children}</div>
    </details>
  );
}

export function RowButtons({ onUp, onDown, onRemove, label }: { onUp?: () => void; onDown?: () => void; onRemove?: () => void; label: string }) {
  const b = "rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-30";
  return (
    <span className="inline-flex">
      <button type="button" className={b} onClick={onUp} disabled={!onUp} aria-label={`Move ${label} up`}><ArrowUp className="h-4 w-4" aria-hidden /></button>
      <button type="button" className={b} onClick={onDown} disabled={!onDown} aria-label={`Move ${label} down`}><ArrowDown className="h-4 w-4" aria-hidden /></button>
      {onRemove ? <button type="button" className={`${b} hover:text-[var(--critical-fg)]`} onClick={onRemove} aria-label={`Remove ${label}`}><Trash2 className="h-4 w-4" aria-hidden /></button> : null}
    </span>
  );
}

// ---------------------------------------------------------------- image upload
/** Shrinks a picture in the browser (longest side 1920 px) and returns it as WebP or JPEG, so a large photo from a phone is fine to upload. */
async function prepare(file: File): Promise<{ mime: "image/webp" | "image/jpeg" | "image/png"; data: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG or WebP picture. SVG is not accepted.");
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale)); canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const quality = Math.max(0.55, 0.88 - attempt * 0.08);
    let mime: "image/webp" | "image/jpeg" = "image/webp";
    let url = canvas.toDataURL(mime, quality);
    if (!url.startsWith("data:image/webp")) { mime = "image/jpeg"; url = canvas.toDataURL(mime, quality); }
    const b64 = url.split(",")[1] ?? "";
    if ((b64.length * 3) / 4 <= IMAGE_LIMIT_BYTES) return { mime, data: b64 };
    scale *= 0.8;
  }
  throw new Error("That picture is too large even after shrinking. Try a smaller one.");
}

/** Uploads to its own slot straight away; the page uses it once the content is saved. */
export function ImageField({ label, slot, versions, onChange, hint }: {
  label: string; slot: string | null; versions: Record<string, number>; onChange: (slot: string | null, versions: Record<string, number>) => void; hint?: string;
}) {
  const id = useId();
  const { run, pending } = useAction();
  const [error, setError] = useState<string | null>(null);
  const url = slot && versions[slot] !== undefined ? `/site-image/${slot}?v=${versions[slot]}` : null;
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const target = slot ?? newSlot();
    try {
      const body = await prepare(file);
      const out = await run(() => apiRequest<{ slot: string; version: number }>("PUT", `site/images/${target}`, body), { success: "Picture uploaded. Save to publish it.", refresh: false });
      if (out) onChange(out.value.slot, { ...versions, [out.value.slot]: out.value.version });
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        {url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt="" className="h-16 w-24 rounded-lg border border-line object-cover" />
          : <span className="flex h-16 w-24 items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">No picture</span>}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1 text-sm font-medium hover:bg-surface"><ImagePlus className="h-4 w-4" aria-hidden />{url ? "Replace" : "Upload"}</label>
          <input id={id} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={pending} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          {url ? <Button variant="secondary" size="sm" onClick={() => onChange(null, versions)} disabled={pending}>Remove</Button> : null}
        </div>
      </div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? <p role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">{error}</p> : null}
    </div>
  );
}
