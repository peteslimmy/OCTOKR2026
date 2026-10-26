"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "./primitives";

// A "+ Create" menu link such as /admin/units?new=unit opens that page's dialog straight away.
export function useOpenOnNew(key: string): boolean { return useSearchParams().get("new") === key; }

// ---------------------------------------------------------------- API client
export class ApiFailure extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown, public correlationId?: string) {
    super(message);
  }
}

// Step-up: the server answers STEP_UP_REQUIRED when a high-risk action needs a fresh second factor. The host component below
// (mounted once in the app shell) asks for it, then the original request is retried exactly once.
let stepUpPrompt: (() => Promise<boolean>) | null = null;
export function setStepUpPrompt(fn: (() => Promise<boolean>) | null) { stepUpPrompt = fn; }

export async function apiRequest<T = unknown>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const res = await fetch(`/api/v1/${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    if (e?.code === "STEP_UP_REQUIRED" && !retried && stepUpPrompt && (await stepUpPrompt())) return apiRequest<T>(method, path, body, true);
    if (typeof window !== "undefined" && !path.startsWith("auth/")) {
      // full navigation on purpose: drops all client state of the half-authenticated session
      /* eslint-disable @next/next/no-location-assign-relative-destination */
      if (e?.code === "MFA_REQUIRED") window.location.href = "/login?mfa=1";
      if (e?.code === "MFA_ENROLMENT_REQUIRED") window.location.href = "/account/security?enrol=1";
      /* eslint-enable @next/next/no-location-assign-relative-destination */
    }
    throw new ApiFailure(e?.code ?? "ERROR", e?.message ?? "Something went wrong. Nothing was changed.", res.status, e?.details, e?.correlationId);
  }
  return json.data as T;
}

/** Uploads a file as multipart form data (the browser sets the boundary). Errors arrive as the same ApiFailure the JSON calls throw. */
export async function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/v1/${path}`, { method: "POST", body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiFailure(e?.code ?? "ERROR", e?.message ?? "The file could not be uploaded. Nothing was changed.", res.status, e?.details, e?.correlationId);
  }
  return json.data as T;
}

type Methods = { totp: boolean; email: boolean };

/** Mount once. Provides the second-factor dialog that apiRequest opens for STEP_UP_REQUIRED. */
export function StepUpHost() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [methods, setMethods] = useState<Methods | null>(null);
  const [method, setMethod] = useState<"totp" | "email">("totp");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  useEffect(() => {
    setStepUpPrompt(() => new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setCode(""); setError(null); setNotice(null); setMethods(null); setMethod("totp"); setSent(false); setCooldown(0); setOpen(true);
      apiRequest<Methods>("GET", "auth/mfa/status")
        .then((s) => { const m = { totp: !!s.totp, email: !!s.email }; setMethods(m); if (!m.totp && m.email) setMethod("email"); })
        .catch(() => setMethods({ totp: true, email: false }));
    }));
    return () => setStepUpPrompt(null);
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const finish = (ok: boolean) => { setOpen(false); resolver.current?.(ok); resolver.current = null; };
  const send = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await apiRequest("POST", "auth/mfa/email/send", { purpose: "STEP_UP" });
      setSent(true); setCooldown(60); setNotice("We sent a 6-digit code to your email address.");
    } catch (err) {
      setError((err as ApiFailure).message);
    }
    setBusy(false);
  };
  const longEnough = code.replace(/\s/g, "").length === 6;
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) finish(false); }} title="Confirm this change"
      description="This action needs a fresh second factor: a code from your authenticator app or one we email you.">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          if (method === "email") await apiRequest("POST", "auth/mfa/email/verify", { code: code.replace(/\s/g, ""), purpose: "STEP_UP" });
          else await apiRequest("POST", "auth/mfa/verify", { code: code.replace(/\s/g, "") });
          finish(true);
        } catch (err) {
          setError((err as ApiFailure).message);
        }
        setBusy(false);
      }}>
        {methods && methods.totp && methods.email ? (
          <div className="flex gap-2" role="group" aria-label="Second factor">
            <button type="button" aria-pressed={method === "totp"} onClick={() => { setMethod("totp"); setError(null); }}
              className={clsx("rounded-lg border px-3 py-1.5 text-sm", method === "totp" ? "border-brand-700 text-brand-700" : "border-line text-muted")}>Authenticator app</button>
            <button type="button" aria-pressed={method === "email"} onClick={() => { setMethod("email"); setError(null); }}
              className={clsx("rounded-lg border px-3 py-1.5 text-sm", method === "email" ? "border-brand-700 text-brand-700" : "border-line text-muted")}>Email code</button>
          </div>
        ) : null}
        {method === "email" ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">{sent ? "Enter the code we emailed you. It works once and expires in 10 minutes." : "We will email you a 6-digit code."}</p>
            <Button type="button" variant="secondary" onClick={send} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Send another code in ${cooldown}s` : sent ? "Send another code" : "Email me a code"}
            </Button>
          </div>
        ) : null}
        <div>
          <label htmlFor="stepup-code" className="block text-sm font-medium">{method === "email" ? "Email code" : "Authenticator code"}</label>
          <input id="stepup-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus
            className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm" />
        </div>
        {notice ? <p role="status" className="text-sm text-[var(--done-fg)]">{notice}</p> : null}
        {error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => finish(false)}>Cancel</Button>
          <Button type="submit" disabled={busy || !longEnough || (method === "email" && !sent)}>{busy ? "Verifying…" : "Confirm"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Toasts (single API: toast.success|info|warning|error)
type ToastKind = "success" | "info" | "warning" | "error";
const DISMISS: Record<ToastKind, number> = { error: 8000, warning: 6000, success: 5000, info: 5000 };
type ToastItem = { id: number; kind: ToastKind; message: string };
const TOAST_EVENT = "4core:toast";

export const toast = {
  success: (m: string) => emit("success", m),
  info: (m: string) => emit("info", m),
  warning: (m: string) => emit("warning", m),
  error: (m: string) => emit("error", m),
};
function emit(kind: ToastKind, message: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { kind, message } }));
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const on = (e: Event) => {
      const { kind, message } = (e as CustomEvent<{ kind: ToastKind; message: string }>).detail;
      const id = ++seq.current;
      setItems((l) => [...l, { id, kind, message }]);
      setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), DISMISS[kind]);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => window.removeEventListener(TOAST_EVENT, on);
  }, []);
  return (
    <>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"}
            className={clsx("toast-in pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg",
              t.kind === "error" && "border-[#fecaca] bg-[var(--critical-bg)] text-[var(--critical-fg)]",
              t.kind === "warning" && "border-[#fde68a] bg-[var(--warn-bg)] text-[var(--warn-fg)]",
              t.kind === "success" && "border-[#bbf7d0] bg-[var(--done-bg)] text-[var(--done-fg)]",
              t.kind === "info" && "border-[#bfdbfe] bg-[var(--info-bg)] text-[var(--info-fg)]")}>
            <span className="sr-only">{t.kind}: </span>{t.message}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Action hook: call API, toast, refresh
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { success?: string; refresh?: boolean } = { refresh: true }): Promise<{ value: T } | undefined> => {
      setPending(true);
      try {
        const out = await fn();
        if (opts.success) toast.success(opts.success);
        if (opts.refresh !== false) router.refresh();
        return { value: out };
      } catch (e) {
        const f = e as ApiFailure;
        // the database words its refusals in plain language (for example why a lock time is not allowed): show that reason after the general message
        const why = typeof f.details === "string" && f.details.trim() && !f.details.startsWith("[") ? ` ${f.details.trim().slice(0, 300)}${/[.!?]$/.test(f.details.trim()) ? "" : "."}` : "";
        toast.error((f.message || "Something went wrong. Nothing was changed.") + why);
        if (f.code === "CONCURRENT_UPDATE") router.refresh();
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [router],
  );
  return { run, pending };
}

// ---------------------------------------------------------------- Dialog (Radix: focus trap, Esc, labelled)
export function Modal({ open, onOpenChange, title, description, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="modal-content fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-panel p-6 shadow-2xl">
          <Dialog.Title className="text-lg font-semibold text-ink">{title}</Dialog.Title>
          <Dialog.Description className={description ? "mt-1 text-sm text-muted" : "sr-only"}>{description ?? title}</Dialog.Description>
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmButton({ label, title, description, confirmLabel, onConfirm, variant = "primary", disabled }: {
  label: string; title: string; description: string; confirmLabel?: string; onConfirm: () => Promise<unknown> | unknown;
  variant?: "primary" | "danger" | "secondary"; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} size="sm" disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={description}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant={variant === "secondary" ? "primary" : variant} disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); setOpen(false); } finally { setBusy(false); } }}>
            {busy ? "Working…" : confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

const subscribeTick = (cb: () => void) => { const t = setInterval(cb, 30_000); return () => clearInterval(t); };
const tickSnapshot = () => Math.floor(Date.now() / 30_000) * 30_000;

/** Server time is authoritative: countdowns are corrected by the offset between server and browser clocks. */
const ClockContext = createContext<number>(0);
export function ClockProvider({ serverNow, children }: { serverNow: string; children: ReactNode }) {
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  return <ClockContext.Provider value={offset}>{children}</ClockContext.Provider>;
}

/** Ticking countdown to a deadline; the instant itself is already "locked" (matches server phase rule). */
export function Countdown({ to, label }: { to: string; label: string }) {
  const offset = useContext(ClockContext);
  const tick = useSyncExternalStore(subscribeTick, tickSnapshot, () => null);
  if (tick === null) return <span className="text-muted">{label}: …</span>;
  const ms = new Date(to).getTime() - (tick + offset);
  if (ms <= 0) return <span className="text-muted">{label}: passed</span>;
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return <span>{label}: <strong className="tabular-nums">{d > 0 ? `${d}d ` : ""}{d > 0 || h > 0 ? `${h}h ` : ""}{m}m</strong></span>;
}
