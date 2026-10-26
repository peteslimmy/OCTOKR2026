"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, ApiFailure } from "@/components/ui/client";
import { Button, Card, Input, Label } from "@/components/ui/primitives";

type Methods = { totp: boolean; email: boolean };
type Method = "totp" | "email";

export function LoginForm({ showForgot = true, forgotLabel = "Forgot your password?" }: { showForgot?: boolean; forgotLabel?: string } = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [recovery, setRecovery] = useState(false);
  // the second step is shown after a correct password, or when a half-signed-in session is sent back here
  const [step, setStep] = useState<"password" | "code">(params.get("mfa") ? "code" : "password");
  // which second factors the account has; until the answer arrives the authenticator flow is assumed
  const [methods, setMethods] = useState<Methods | null>(null);
  const [method, setMethod] = useState<Method>("totp");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const resetNotice = params.get("reset") ? "Your password was changed. Sign in with the new one." : null;

  const done = (enrol: boolean) => {
    router.replace(enrol ? "/account/security?enrol=1" : "/dashboard");
    router.refresh();
  };

  // a half-signed-in session cannot read its methods from the password response, so ask once on arrival
  useEffect(() => {
    if (!params.get("mfa")) return;
    let live = true;
    apiRequest<Methods>("GET", "auth/mfa/status")
      .then((s) => {
        if (!live) return;
        const m = { totp: !!s.totp, email: !!s.email };
        setMethods(m);
        setMethod(m.totp ? "totp" : "email");
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [params]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendEmail = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest("POST", "auth/mfa/email/send", { purpose: "LOGIN" });
      setSent(true);
      setCooldown(60);
      setNotice("We sent a 6-digit code to your email address.");
    } catch (err) {
      setError((err as ApiFailure).message);
    }
    setBusy(false);
  };

  if (step === "code" && recovery) {
    return (
      <Card className="p-6">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const f = new FormData(e.currentTarget);
            try {
              const out = await apiRequest<{ mfaEnrolmentRequired?: boolean }>("POST", "auth/mfa/recover", { code: String(f.get("recovery") ?? "") });
              done(!!out.mfaEnrolmentRequired);
            } catch (err) {
              const fail = err as ApiFailure;
              if (fail.status === 401 && fail.code === "AUTHENTICATION_REQUIRED") { setStep("password"); setRecovery(false); setError("Your sign-in expired. Sign in again."); }
              else setError(fail.message);
              setBusy(false);
            }
          }}
        >
          <div>
            <Label htmlFor="recovery">Recovery code</Label>
            <Input id="recovery" name="recovery" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} required autoFocus aria-describedby="recovery-help" />
            <p id="recovery-help" className="mt-1 text-xs text-muted">One of the codes you saved when you set up your authenticator, for example ABCD-EFGH-JKMN. Each code works once. Using one removes your authenticator, signs out your other sessions and asks you to set up a new one.</p>
          </div>
          <div className="min-h-5">{error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}</div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Checking…" : "Use recovery code"}</Button>
          <button type="button" className="w-full text-center text-sm text-brand-700 underline" onClick={() => { setRecovery(false); setError(null); }}>Back to your code</button>
        </form>
      </Card>
    );
  }

  if (step === "code") {
    const useEmail = method === "email";
    return (
      <Card className="p-6">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const f = new FormData(e.currentTarget);
            const code = String(f.get("code") ?? "").replace(/\s/g, "");
            try {
              if (useEmail) await apiRequest("POST", "auth/mfa/email/verify", { code, purpose: "LOGIN" });
              else await apiRequest("POST", "auth/mfa/verify", { code });
              done(false);
            } catch (err) {
              const fail = err as ApiFailure;
              if (fail.status === 401 && fail.code === "AUTHENTICATION_REQUIRED") { setStep("password"); setError("Your sign-in expired. Sign in again."); }
              else setError(fail.message);
              setBusy(false);
            }
          }}
        >
          <div>
            <p className="text-sm font-medium">Two-step verification</p>
            <p className="mt-1 text-xs text-muted">
              {useEmail
                ? sent ? "Enter the code we emailed you." : "We will email a 6-digit code to the address on your account."
                : "Enter the 6-digit code from your authenticator app."}
            </p>
          </div>
          {methods && methods.totp && methods.email ? (
            <div className="flex gap-2" role="group" aria-label="Second factor">
              <button type="button" aria-pressed={!useEmail} onClick={() => { setMethod("totp"); setError(null); }}
                className={`rounded-lg border px-3 py-1.5 text-sm ${useEmail ? "border-line text-muted" : "border-brand-700 text-brand-700"}`}>Authenticator app</button>
              <button type="button" aria-pressed={useEmail} onClick={() => { setMethod("email"); setError(null); }}
                className={`rounded-lg border px-3 py-1.5 text-sm ${useEmail ? "border-brand-700 text-brand-700" : "border-line text-muted"}`}>Email code</button>
            </div>
          ) : null}
          {useEmail ? (
            <Button type="button" variant="secondary" className="w-full" onClick={sendEmail} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Send another code in ${cooldown}s` : sent ? "Send another code" : "Email me a code"}
            </Button>
          ) : null}
          <div>
            <Label htmlFor="code">{useEmail ? "Email code" : "Authenticator code"}</Label>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus aria-describedby="code-help" />
            <p id="code-help" className="mt-1 text-xs text-muted">{useEmail ? "Codes are 6 digits and expire after 10 minutes." : "Codes are 6 digits and change every 30 seconds."}</p>
          </div>
          <div className="min-h-5">
            {notice ? <p role="status" className="text-sm text-[var(--done-fg)]">{notice}</p> : null}
            {error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}
          </div>
          <Button type="submit" className="w-full" disabled={busy || (useEmail && !sent)}>{busy ? "Verifying…" : "Verify"}</Button>
          {methods?.totp ? (
            <button type="button" className="w-full text-center text-sm text-brand-700 underline" onClick={() => { setRecovery(true); setError(null); }}>Lost your device? Use a recovery code</button>
          ) : null}
          <button type="button" className="w-full text-center text-sm text-brand-700 underline"
            onClick={async () => {
              await apiRequest("POST", "auth/logout").catch(() => undefined);
              setStep("password"); setMethods(null); setMethod("totp"); setSent(false); setCooldown(0); setNotice(null); setError(null);
            }}>
            Use a different account
          </button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setNotice(null);
          const f = new FormData(e.currentTarget);
          try {
            const out = await apiRequest<{ ok: boolean; mfaRequired?: boolean; mfaEnrolmentRequired?: boolean; methods?: Methods }>("POST", "auth/login", { email: f.get("email"), password: f.get("password") });
            if (out.mfaRequired) {
              const m = out.methods ?? { totp: true, email: false };
              setMethods(m);
              setMethod(m.totp ? "totp" : "email");
              setSent(false);
              setCooldown(0);
              setStep("code");
              setBusy(false);
              return;
            }
            done(!!out.mfaEnrolmentRequired);
          } catch (err) {
            setError((err as ApiFailure).message);
            setBusy(false);
          }
        }}
      >
        {resetNotice ? <p role="status" className="text-sm text-[var(--done-fg)]">{resetNotice}</p> : null}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required aria-describedby={error ? "login-error" : undefined} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required className="pr-16" />
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword} aria-controls="password"
              className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-xs font-medium text-brand-700 hover:bg-surface">
              {showPassword ? "Hide" : "Show"}<span className="sr-only"> password</span>
            </button>
          </div>
        </div>
        <div className="min-h-5">{error ? <p id="login-error" role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}</div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        {showForgot ? <p className="text-center text-sm"><Link href="/forgot-password" className="text-brand-700 underline">{forgotLabel}</Link></p> : null}
      </form>
    </Card>
  );
}
