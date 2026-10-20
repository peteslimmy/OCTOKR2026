"use client";

import clsx from "clsx";
import { ExternalLink, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuthFrame } from "@/components/site/auth-frame";
import { LandingView, type SiteBrand } from "@/components/site/landing-view";
import { Segmented } from "@/components/motion/segmented";
import { apiRequest, ConfirmButton, useAction } from "@/components/ui/client";
import { Button, Input, Label } from "@/components/ui/primitives";
import { DEFAULT_LANDING, DEFAULT_LOGIN, type SiteConfig } from "@/lib/site-content";
import { LandingPanel } from "./landing-panel";
import { LoginPanel } from "./login-panel";

type Tab = "landing" | "login";

/** A fixed-size page drawn small enough to fit its box, so what the person sees is the real layout of a desktop or a phone. */
function Scaled({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / width));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} className="w-full overflow-hidden rounded-xl border border-line bg-surface" style={{ height: height * scale }}>
      {/* a picture of the page, not the page: hidden from assistive technology and not focusable, so its landmarks and links never compete with the editor */}
      <div aria-hidden inert style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }} className="overflow-hidden">{children}</div>
    </div>
  );
}

function MockForm({ title, subtitle, footnote, forgot }: { title: string; subtitle: string; footnote: string; forgot: string | null }) {
  return (
    <div className="w-full max-w-sm" aria-hidden>
      <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
      {subtitle ? <p className="mt-2 text-sm text-muted">{subtitle}</p> : null}
      <div className="mt-8 space-y-4 rounded-xl border border-line bg-white p-6">
        <div><Label htmlFor="mock-email">Email</Label><Input id="mock-email" tabIndex={-1} readOnly /></div>
        <div><Label htmlFor="mock-pw">Password</Label><Input id="mock-pw" type="password" tabIndex={-1} readOnly /></div>
        <div className="rounded-lg bg-brand-700 py-2 text-center text-sm font-medium text-white">Sign in</div>
        {forgot ? <p className="text-center text-sm text-brand-700 underline">{forgot}</p> : null}
      </div>
      {footnote ? <p className="mt-6 text-xs text-muted">{footnote}</p> : null}
    </div>
  );
}

export function SiteEditor({ initial, versions: initialVersions, brand }: { initial: SiteConfig; versions: Record<string, number>; brand: SiteBrand }) {
  const [landing, setLandingState] = useState(initial.landing);
  const [login, setLoginState] = useState(initial.login);
  const [versions, setVersions] = useState(initialVersions);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [tab, setTab] = useState<Tab>("landing");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction();

  const setLanding = (f: (l: SiteConfig["landing"]) => SiteConfig["landing"]) => setLandingState((l) => f(l));
  const setLogin = (f: (l: SiteConfig["login"]) => SiteConfig["login"]) => setLoginState((l) => f(l));
  const dirty = useMemo(() => JSON.stringify({ landing, login }) !== saved, [landing, login, saved]);

  // leaving with unsaved work asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async () => {
    setError(null);
    try {
      const out = await run(() => apiRequest("PUT", "site", { landing, login }), { success: "Saved. The live pages now show these changes.", refresh: false });
      if (out) setSaved(JSON.stringify({ landing, login }));
    } catch (e) { setError((e as Error).message); }
  };

  const preview = tab === "landing"
    ? <LandingView config={landing} brand={brand} images={versions} preview />
    : (
      <AuthFrame login={login} brand={brand} images={versions} preview>
        <MockForm title={login.form.title} subtitle={login.form.subtitle} footnote={login.form.footnote} forgot={login.form.showForgot ? login.form.forgotLabel : null} />
      </AuthFrame>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="What to edit" value={tab} onChange={setTab} options={[{ value: "landing", label: "Landing page" }, { value: "login", label: "Sign-in screens" }]} />
        <div className="flex flex-wrap items-center gap-2">
          <a href={tab === "landing" ? "/" : "/login"} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1 text-sm font-medium hover:bg-surface"><ExternalLink className="h-4 w-4" aria-hidden />Open the live page<span className="sr-only"> (new tab)</span></a>
          <ConfirmButton variant="secondary" label="Reset this page" title={`Reset the ${tab === "landing" ? "landing page" : "sign-in screens"} to the built-in content?`} description="Your wording, sections and picture choices on this page go back to the originals. Nothing changes on the live page until you save." confirmLabel="Reset"
            onConfirm={() => { if (tab === "landing") setLandingState(DEFAULT_LANDING); else setLoginState(DEFAULT_LOGIN); }} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="min-w-0">{tab === "landing" ? <LandingPanel landing={landing} setLanding={setLanding} versions={versions} setVersions={setVersions} /> : <LoginPanel login={login} setLogin={setLogin} versions={versions} setVersions={setVersions} />}</div>
        <div className="min-w-0 space-y-3 xl:sticky xl:top-20 xl:self-start">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Preview <span className="font-normal text-muted">— updates as you type</span></h2>
            <Segmented size="sm" label="Preview size" value={device} onChange={setDevice} options={[{ value: "desktop", label: "Desktop" }, { value: "phone", label: "Phone" }]} />
          </div>
          {device === "desktop"
            ? <Scaled width={1280} height={tab === "landing" ? 1700 : 800}>{preview}</Scaled>
            : <div className="mx-auto max-w-[260px]"><Scaled width={390} height={tab === "landing" ? 1500 : 800}><div className="h-full">{tab === "landing" ? preview : <div className="flex min-h-full items-center justify-center bg-white p-4"><MockForm title={login.form.title} subtitle={login.form.subtitle} footnote={login.form.footnote} forgot={login.form.showForgot ? login.form.forgotLabel : null} /></div>}</div></Scaled></div>}
          <p className="text-xs text-muted">{device === "phone" && tab === "login" ? "On phones the side panel is hidden and only the form is shown." : "The preview is a scaled copy of the real page. Links are switched off here."}</p>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <p className={clsx("text-sm", dirty ? "font-medium text-[var(--warn-fg)]" : "text-muted")} role="status">{dirty ? "You have unsaved changes." : "All changes are saved."}</p>
        <div className="flex items-center gap-2">
          {error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}
          <Button variant="secondary" disabled={!dirty || pending} onClick={() => { const s = JSON.parse(saved) as SiteConfig; setLandingState(s.landing); setLoginState(s.login); setError(null); }}><RotateCcw className="h-4 w-4" aria-hidden />Discard changes</Button>
          <Button disabled={!dirty || pending} onClick={save}>{pending ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>
    </div>
  );
}
