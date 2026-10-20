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

// Step-up: the server answers STEP_UP_REQUIRED when a high-risk action needs a fresh authenticator code. The host component below
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

/** Mount once. Provides the authenticator-code dialog that apiRequest opens for STEP_UP_REQUIRED. */
export function StepUpHost() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  useEffect(() => {
    setStepUpPrompt(() => new Promise<boolean>((resolve) => { resolver.current = resolve; setCode(""); setError(null); setOpen(true); }));
    return () => setStepUpPrompt(null);
  }, []);
  const finish = (ok: boolean) => { setOpen(false); resolver.current?.(ok); resolver.current = null; };
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) finish(false); }} title="Confirm with your authenticator"
      description="This action needs a fresh 6-digit code from your authenticator app.">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await apiRequest("POST", "auth/mfa/verify", { code: code.replace(/\s/g, "") });
          finish(true);
        } catch (err) {
          setError((err as ApiFailure).message);
        }
        setBusy(false);
      }}>
        <label htmlFor="stepup-code" className="block text-sm font-medium">Authenticator code</label>
        <input id="stepup-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus
          className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm" />
        {error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => finish(false)}>Cancel</Button>
          <Button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6}>{busy ? "Verifying…" : "Confirm"}</Button>
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
