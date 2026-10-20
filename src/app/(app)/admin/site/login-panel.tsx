"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { LoginConfig } from "@/lib/site-content";
import { Group, IconField, ImageField, RowButtons, SelectField, SliderField, TextField, Toggle } from "./controls";

type Versions = Record<string, number>;
interface Props { login: LoginConfig; setLogin: (f: (l: LoginConfig) => LoginConfig) => void; versions: Versions; setVersions: (v: Versions) => void }

const LAYOUTS: { value: LoginConfig["layout"]; label: string; hint: string }[] = [
  { value: "split-left", label: "Picture panel on the left", hint: "Words and points beside the form" },
  { value: "split-right", label: "Picture panel on the right", hint: "The form first, the panel after" },
  { value: "centered", label: "Form in the middle", hint: "Plain page, no side panel" },
  { value: "background", label: "Full-page picture", hint: "A card over a full-width picture" },
];

export function LoginPanel({ login, setLogin, versions, setVersions }: Props) {
  const { panel, form } = login;
  const setPanel = (p: Partial<LoginConfig["panel"]>) => setLogin((l) => ({ ...l, panel: { ...l.panel, ...p } }));
  const setForm = (p: Partial<LoginConfig["form"]>) => setLogin((l) => ({ ...l, form: { ...l.form, ...p } }));
  const usesPicture = login.layout === "background" || login.layout.startsWith("split");
  return (
    <div className="space-y-3">
      <Group title="Layout" defaultOpen summary={login.layout}>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">How the sign-in screens are arranged</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {LAYOUTS.map((o) => (
              <label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${login.layout === o.value ? "border-brand-700 bg-brand-50" : "border-line bg-panel hover:bg-surface"}`}>
                <input type="radio" name="login-layout" checked={login.layout === o.value} onChange={() => setLogin((l) => ({ ...l, layout: o.value }))} className="mt-1 accent-[var(--brand-700)]" />
                <span><span className="block font-medium">{o.label}</span><span className="text-xs text-muted">{o.hint}</span></span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">The same layout is used for sign-in, forgot password and reset password. On phones only the form is shown.</p>
        </fieldset>
      </Group>

      {login.layout !== "centered" ? (
        <Group title="Side panel" defaultOpen summary={panel.tone}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Colour" value={panel.tone} onChange={(v) => setPanel({ tone: v })} options={[{ value: "brand", label: "Brand colour" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
            <div className="space-y-3 pt-6"><Toggle label="Show the logo" checked={panel.showLogo} onChange={(v) => setPanel({ showLogo: v })} /><Toggle label="Show the built-in illustration" checked={panel.showArt} onChange={(v) => setPanel({ showArt: v })} hint="Used when no picture is set." /></div>
          </div>
          <TextField label="Headline" value={panel.headline} max={200} multiline onChange={(v) => setPanel({ headline: v })} hint="Leave empty to hide it." />
          <p className="text-sm font-medium">Points ({panel.points.length} of 5)</p>
          {panel.points.map((p, i) => (
            <div key={i} className="grid items-end gap-3 sm:grid-cols-[10rem_1fr_auto]">
              <IconField label="Icon" value={p.icon} onChange={(v) => setPanel({ points: panel.points.map((x, n) => (n === i ? { ...x, icon: v } : x)) })} />
              <TextField label="Text" value={p.text} max={200} onChange={(v) => setPanel({ points: panel.points.map((x, n) => (n === i ? { ...x, text: v } : x)) })} />
              <RowButtons label={`point ${i + 1}`} onRemove={() => setPanel({ points: panel.points.filter((_, n) => n !== i) })} />
            </div>
          ))}
          {panel.points.length < 5 ? <Button variant="secondary" size="sm" onClick={() => setPanel({ points: [...panel.points, { icon: "check", text: "A new point" }] })}><Plus className="h-4 w-4" aria-hidden />Add a point</Button> : null}
          <TextField label="Small print at the bottom" value={panel.footerText} max={160} onChange={(v) => setPanel({ footerText: v })} />
        </Group>
      ) : (
        <Group title="Page" summary="plain page">
          <Toggle label="Show the logo above the form" checked={panel.showLogo} onChange={(v) => setPanel({ showLogo: v })} />
          <TextField label="Small print at the bottom" value={panel.footerText} max={160} onChange={(v) => setPanel({ footerText: v })} />
        </Group>
      )}

      {usesPicture ? (
        <Group title="Picture" defaultOpen summary={panel.showImage ? "on" : "off"}>
          <Toggle label="Use a picture" checked={panel.showImage} onChange={(v) => setPanel({ showImage: v })} hint="Without a picture the panel uses its colour." />
          {panel.showImage ? (
            <>
              <ImageField label="Sign-in picture" slot={panel.imageSlot} versions={versions} onChange={(s, v) => { setVersions(v); setPanel({ imageSlot: s }); }} hint="Tall or square pictures suit the side panel; wide ones suit the full-page layout." />
              <TextField label="Describe the picture (for screen readers)" value={panel.imageAlt} max={200} onChange={(v) => setPanel({ imageAlt: v })} />
              <SliderField label="Darken the picture" value={panel.overlay} max={90} onChange={(v) => setPanel({ overlay: v })} hint="Keeps the words easy to read." />
            </>
          ) : null}
        </Group>
      ) : null}

      <Group title="The form" defaultOpen summary={form.title}>
        <TextField label="Title" value={form.title} max={80} onChange={(v) => setForm({ title: v })} />
        <TextField label="Sentence under the title" value={form.subtitle} max={240} multiline onChange={(v) => setForm({ subtitle: v })} />
        <TextField label="Note under the form" value={form.footnote} max={400} multiline onChange={(v) => setForm({ footnote: v })} hint="Keep the sentence saying the page never reveals whether an account exists." />
        <Toggle label="Show the forgot-password link" checked={form.showForgot} onChange={(v) => setForm({ showForgot: v })} />
        {form.showForgot ? <TextField label="Forgot-password link text" value={form.forgotLabel} max={60} onChange={(v) => setForm({ forgotLabel: v })} /> : null}
        <Toggle label="Show a link back to the home page" checked={form.showBackLink} onChange={(v) => setForm({ showBackLink: v })} />
        {form.showBackLink ? <TextField label="Back link text" value={form.backLabel} max={60} onChange={(v) => setForm({ backLabel: v })} /> : null}
      </Group>
    </div>
  );
}
