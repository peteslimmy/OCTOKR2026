"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { SECTION_TYPES, type LandingConfig, type SectionType, type SiteItem, type SiteSection } from "@/lib/site-content";
import { Group, IconField, ImageField, RowButtons, SelectField, SliderField, TextField, Toggle } from "./controls";

type Versions = Record<string, number>;
interface Props { landing: LandingConfig; setLanding: (f: (l: LandingConfig) => LandingConfig) => void; versions: Versions; setVersions: (v: Versions) => void }

const TYPE_LABEL: Record<SectionType, string> = { features: "Feature cards", steps: "Numbered steps", stats: "Figures band", gallery: "Picture gallery", quote: "Testimonial", trust: "Checklist", cta: "Call to action", text: "Text and picture" };
const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => { const j = i + d; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j], c[i]]; return c; };

function blankSection(type: SectionType, existing: string[]): SiteSection {
  let id: string = type, n = 2;
  while (existing.includes(id)) id = `${type}-${n++}`;
  const base: SiteSection = { id, type, enabled: true, title: TYPE_LABEL[type], intro: "", background: "white", columns: 3, button: null, imageSlot: null, items: [] };
  switch (type) {
    case "features": return { ...base, items: [{ icon: "target", title: "A feature", text: "Say what it does for the reader." }] };
    case "steps": return { ...base, columns: 4, items: [{ title: "First step", text: "What happens." }] };
    case "stats": return { ...base, columns: 3, items: [{ value: "0", label: "Describe the figure" }] };
    case "quote": return { ...base, title: "", background: "surface", items: [{ text: "A short quote.", author: "Name", role: "Role" }] };
    case "trust": return { ...base, columns: 2, items: [{ text: "A point worth knowing" }] };
    case "cta": return { ...base, background: "brand", title: "Ready to start?", button: { label: "Sign in", href: "/login" } };
    case "text": return { ...base, intro: "Write a paragraph here. A blank line starts a new paragraph.", button: null };
    default: return base;
  }
}

export function LandingPanel({ landing, setLanding, versions, setVersions }: Props) {
  const { header, hero, footer } = landing;
  const setHero = (p: Partial<LandingConfig["hero"]>) => setLanding((l) => ({ ...l, hero: { ...l.hero, ...p } }));
  const setSection = (i: number, p: Partial<SiteSection>) => setLanding((l) => ({ ...l, sections: l.sections.map((s, n) => (n === i ? { ...s, ...p } : s)) }));
  const setItems = (i: number, fn: (items: SiteItem[]) => SiteItem[]) => setLanding((l) => ({ ...l, sections: l.sections.map((s, n) => (n === i ? { ...s, items: fn(s.items) } : s)) }));

  return (
    <div className="space-y-3">
      <Group title="Header" summary={`${header.links.length} links`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Sign-in button text" value={header.signInLabel} max={40} onChange={(v) => setLanding((l) => ({ ...l, header: { ...l.header, signInLabel: v } }))} />
          <div className="space-y-3 pt-6"><Toggle label="Show the menu links" checked={header.showNav} onChange={(v) => setLanding((l) => ({ ...l, header: { ...l.header, showNav: v } }))} /><Toggle label="Keep the header at the top while scrolling" checked={header.sticky} onChange={(v) => setLanding((l) => ({ ...l, header: { ...l.header, sticky: v } }))} /></div>
        </div>
        <p className="text-sm font-medium">Menu links</p>
        {header.links.map((link, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <TextField label="Text" value={link.label} max={60} onChange={(v) => setLanding((l) => ({ ...l, header: { ...l.header, links: l.header.links.map((x, n) => (n === i ? { ...x, label: v } : x)) } }))} />
            <TextField label="Goes to" value={link.href} max={300} hint="/page, #section, https://… or mailto:…" onChange={(v) => setLanding((l) => ({ ...l, header: { ...l.header, links: l.header.links.map((x, n) => (n === i ? { ...x, href: v } : x)) } }))} />
            <RowButtons label={`link ${link.label}`} onUp={i > 0 ? () => setLanding((l) => ({ ...l, header: { ...l.header, links: move(l.header.links, i, -1) } })) : undefined} onDown={i < header.links.length - 1 ? () => setLanding((l) => ({ ...l, header: { ...l.header, links: move(l.header.links, i, 1) } })) : undefined}
              onRemove={() => setLanding((l) => ({ ...l, header: { ...l.header, links: l.header.links.filter((_, n) => n !== i) } }))} />
          </div>
        ))}
        {header.links.length < 5 ? <Button variant="secondary" size="sm" onClick={() => setLanding((l) => ({ ...l, header: { ...l.header, links: [...l.header.links, { label: "New link", href: "#" }] } }))}><Plus className="h-4 w-4" aria-hidden />Add a link</Button> : null}
      </Group>

      <Group title="Top banner (hero)" defaultOpen summary={hero.layout}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Layout" value={hero.layout} onChange={(v) => setHero({ layout: v })} options={[{ value: "split", label: "Words beside a picture" }, { value: "centered", label: "Centred, picture below" }, { value: "background", label: "Words over a full-width picture" }]} />
          <SelectField label="Colour" value={hero.tone} onChange={(v) => setHero({ tone: v })} options={[{ value: "brand", label: "Brand colour" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
          <SelectField label="Headline size" value={hero.size} onChange={(v) => setHero({ size: v })} options={[{ value: "md", label: "Medium" }, { value: "lg", label: "Large" }, { value: "xl", label: "Extra large" }]} />
          <SelectField label="Text alignment" value={hero.align} onChange={(v) => setHero({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }]} />
        </div>
        <TextField label="Small line above the headline" value={hero.eyebrow} max={80} onChange={(v) => setHero({ eyebrow: v })} hint="Leave empty to hide it." />
        <TextField label="Headline" value={hero.headline} max={160} onChange={(v) => setHero({ headline: v })} />
        <TextField label="Supporting sentence" value={hero.subheadline} max={400} multiline onChange={(v) => setHero({ subheadline: v })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Main button text" value={hero.primary.label} max={60} onChange={(v) => setHero({ primary: { ...hero.primary, label: v } })} />
          <TextField label="Main button goes to" value={hero.primary.href} max={300} onChange={(v) => setHero({ primary: { ...hero.primary, href: v } })} />
          <TextField label="Second button text" value={hero.secondary.label} max={60} onChange={(v) => setHero({ secondary: { ...hero.secondary, label: v } })} />
          <TextField label="Second button goes to" value={hero.secondary.href} max={300} onChange={(v) => setHero({ secondary: { ...hero.secondary, href: v } })} />
        </div>
        <Toggle label="Show the second button" checked={hero.secondary.show} onChange={(v) => setHero({ secondary: { ...hero.secondary, show: v } })} />
        <SelectField label="Picture" value={hero.visual} onChange={(v) => setHero({ visual: v })} options={[{ value: "illustration", label: "Built-in dashboard illustration" }, { value: "image", label: "A picture I upload" }, { value: "3d", label: "Turning 3D columns" }, { value: "none", label: "No picture" }]} hint="With the full-width layout, the picture is the background." />
        {hero.visual === "image" || hero.layout === "background" ? (
          <>
            <ImageField label="Banner picture" slot={hero.imageSlot} versions={versions} onChange={(s, v) => { setVersions(v); setHero({ imageSlot: s }); }} hint="Wide pictures work best. Large photos are shrunk for you." />
            <TextField label="Describe the picture (for screen readers)" value={hero.imageAlt} max={200} onChange={(v) => setHero({ imageAlt: v })} />
            {hero.layout === "background" ? <SliderField label="Darken the picture" value={hero.overlay} max={90} onChange={(v) => setHero({ overlay: v })} hint="Keeps the words easy to read." /> : null}
          </>
        ) : null}
        {hero.layout === "split" ? <Toggle label="Show the weekly calendar note" checked={hero.showCalendarCard} onChange={(v) => setHero({ showCalendarCard: v })} /> : null}
      </Group>

      <div className="flex items-center justify-between pt-2">
        <h3 className="text-sm font-semibold">Sections ({landing.sections.length})</h3>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Add a section</span>
          <select aria-label="Add a section" value="" onChange={(e) => { const t = e.target.value as SectionType; if (t) setLanding((l) => ({ ...l, sections: [...l.sections, blankSection(t, l.sections.map((s) => s.id))] })); }} className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm">
            <option value="">+ Add a section…</option>{SECTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
      </div>

      {landing.sections.map((s, i) => (
        <Group key={s.id} title={s.title || TYPE_LABEL[s.type]} summary={`${TYPE_LABEL[s.type]}${s.enabled ? "" : " · hidden"}`}
          actions={<RowButtons label={s.title || TYPE_LABEL[s.type]} onUp={i > 0 ? () => setLanding((l) => ({ ...l, sections: move(l.sections, i, -1) })) : undefined} onDown={i < landing.sections.length - 1 ? () => setLanding((l) => ({ ...l, sections: move(l.sections, i, 1) })) : undefined}
            onRemove={() => setLanding((l) => ({ ...l, sections: l.sections.filter((_, n) => n !== i) }))} />}>
          <Toggle label="Show this section on the page" checked={s.enabled} onChange={(v) => setSection(i, { enabled: v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            {s.type !== "quote" ? <TextField label="Heading" value={s.title} max={120} onChange={(v) => setSection(i, { title: v })} /> : null}
            <SelectField label="Background" value={s.background} onChange={(v) => setSection(i, { background: v })} options={[{ value: "white", label: "White" }, { value: "surface", label: "Light grey" }, { value: "brand", label: "Brand colour" }]} />
            {["features", "steps", "stats", "gallery"].includes(s.type) ? <SelectField label="Columns" value={s.columns} onChange={(v) => setSection(i, { columns: v })} options={[{ value: 2, label: "2" }, { value: 3, label: "3" }, { value: 4, label: "4" }]} /> : null}
          </div>
          {s.type !== "quote" ? <TextField label={s.type === "text" ? "Text (a blank line starts a new paragraph)" : "Introduction"} value={s.intro} max={400} multiline onChange={(v) => setSection(i, { intro: v })} /> : null}
          {["cta", "text"].includes(s.type) ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Button text" value={s.button?.label ?? ""} max={60} hint="Leave empty for no button." onChange={(v) => setSection(i, { button: v || s.button?.href ? { label: v, href: s.button?.href ?? "/login" } : null })} />
              <TextField label="Button goes to" value={s.button?.href ?? ""} max={300} onChange={(v) => setSection(i, { button: { label: s.button?.label ?? "", href: v } })} />
            </div>
          ) : null}
          {["trust", "text", "quote"].includes(s.type) ? <ImageField label={s.type === "quote" ? "Photo of the person" : "Picture"} slot={s.imageSlot} versions={versions} onChange={(slot, v) => { setVersions(v); setSection(i, { imageSlot: slot }); }} /> : null}

          {["features", "steps", "stats", "gallery", "trust"].includes(s.type) ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Items ({s.items.length})</p>
              {s.items.map((it, n) => {
                const set = (p: Partial<SiteItem>) => setItems(i, (list) => list.map((x, k) => (k === n ? { ...x, ...p } : x)));
                return (
                  <div key={n} className="space-y-3 rounded-lg border border-line bg-surface/50 p-3">
                    <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted">Item {n + 1}</span>
                      <RowButtons label={`item ${n + 1}`} onUp={n > 0 ? () => setItems(i, (l) => move(l, n, -1)) : undefined} onDown={n < s.items.length - 1 ? () => setItems(i, (l) => move(l, n, 1)) : undefined} onRemove={() => setItems(i, (l) => l.filter((_, k) => k !== n))} /></div>
                    {s.type === "features" ? <div className="grid gap-3 sm:grid-cols-2"><IconField label="Icon" value={it.icon ?? "target"} onChange={(v) => set({ icon: v })} /><TextField label="Title" value={it.title ?? ""} max={120} onChange={(v) => set({ title: v })} /></div> : null}
                    {s.type === "steps" ? <TextField label="Title" value={it.title ?? ""} max={120} onChange={(v) => set({ title: v })} /> : null}
                    {s.type === "stats" ? <div className="grid gap-3 sm:grid-cols-2"><TextField label="Figure" value={it.value ?? ""} max={24} onChange={(v) => set({ value: v })} hint="For example 13, 100% or 4.5k." /><TextField label="What it measures" value={it.label ?? ""} max={80} onChange={(v) => set({ label: v })} /></div> : null}
                    {s.type === "gallery" ? <><ImageField label="Picture" slot={it.imageSlot ?? null} versions={versions} onChange={(slot, v) => { setVersions(v); set({ imageSlot: slot }); }} /><div className="grid gap-3 sm:grid-cols-2"><TextField label="Describe it (screen readers)" value={it.alt ?? ""} max={200} onChange={(v) => set({ alt: v })} /><TextField label="Caption" value={it.caption ?? ""} max={160} onChange={(v) => set({ caption: v })} /></div></> : null}
                    {["features", "steps", "trust"].includes(s.type) ? <TextField label={s.type === "trust" ? "Point" : "Description"} value={it.text ?? ""} max={600} multiline={s.type !== "trust"} onChange={(v) => set({ text: v })} /> : null}
                  </div>
                );
              })}
              {s.items.length < 12 ? <Button variant="secondary" size="sm" onClick={() => setItems(i, (l) => [...l, s.type === "features" ? { icon: "target", title: "New feature", text: "" } : s.type === "stats" ? { value: "0", label: "" } : s.type === "gallery" ? { imageSlot: null, alt: "", caption: "" } : s.type === "trust" ? { text: "" } : { title: "New step", text: "" }])}><Plus className="h-4 w-4" aria-hidden />Add an item</Button> : null}
            </div>
          ) : null}

          {s.type === "quote" ? (
            <div className="space-y-3">
              <TextField label="Quote" value={s.items[0]?.text ?? ""} max={600} multiline onChange={(v) => setItems(i, (l) => [{ ...(l[0] ?? {}), text: v }])} />
              <div className="grid gap-3 sm:grid-cols-2"><TextField label="Name" value={s.items[0]?.author ?? ""} max={80} onChange={(v) => setItems(i, (l) => [{ ...(l[0] ?? {}), author: v }])} /><TextField label="Role" value={s.items[0]?.role ?? ""} max={80} onChange={(v) => setItems(i, (l) => [{ ...(l[0] ?? {}), role: v }])} /></div>
            </div>
          ) : null}
        </Group>
      ))}

      <Group title="Footer" summary={`${footer.links.length} links`}>
        <TextField label="Footer text" value={footer.text} max={200} onChange={(v) => setLanding((l) => ({ ...l, footer: { ...l.footer, text: v } }))} />
        <Toggle label="Show a sign-in link in the footer" checked={footer.showSignIn} onChange={(v) => setLanding((l) => ({ ...l, footer: { ...l.footer, showSignIn: v } }))} />
        {footer.links.map((link, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <TextField label="Text" value={link.label} max={60} onChange={(v) => setLanding((l) => ({ ...l, footer: { ...l.footer, links: l.footer.links.map((x, n) => (n === i ? { ...x, label: v } : x)) } }))} />
            <TextField label="Goes to" value={link.href} max={300} onChange={(v) => setLanding((l) => ({ ...l, footer: { ...l.footer, links: l.footer.links.map((x, n) => (n === i ? { ...x, href: v } : x)) } }))} />
            <RowButtons label={`footer link ${link.label}`} onRemove={() => setLanding((l) => ({ ...l, footer: { ...l.footer, links: l.footer.links.filter((_, n) => n !== i) } }))} />
          </div>
        ))}
        {footer.links.length < 6 ? <Button variant="secondary" size="sm" onClick={() => setLanding((l) => ({ ...l, footer: { ...l.footer, links: [...l.footer.links, { label: "New link", href: "#" }] } }))}><Plus className="h-4 w-4" aria-hidden />Add a link</Button> : null}
      </Group>
    </div>
  );
}
