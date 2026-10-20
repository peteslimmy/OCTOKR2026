"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, ApiFailure, useAction } from "@/components/ui/client";
import { Badge, Banner, Button, Card, CardHeader, Input, Label, Field } from "@/components/ui/primitives";

type Mfa = { required: boolean; enrolled: boolean; aal: "aal1" | "aal2"; recoveryCodesRemaining?: number };
type Enrolment = { factorId: string; qrCode: string; secret: string };

/** The one-time list of recovery codes. Shown right after setup and after "make new codes"; it cannot be shown again, so the person must confirm they kept it. */
function RecoveryCodesDialog({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4" role="region" aria-label="Your recovery codes">
      <h3 className="font-semibold">Save your recovery codes</h3>
      <p>If you lose your phone, one of these codes lets you back in. Each works once. They are shown only now: store them somewhere safe, away from your password.</p>
      <ul className="grid gap-1 font-mono text-sm sm:grid-cols-2">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard?.writeText(text); }}>Copy codes</Button>
        <Button variant="secondary" size="sm" onClick={() => {
          const url = URL.createObjectURL(new Blob([`4CORE-OKR recovery codes\r\nEach code works once.\r\n\r\n${codes.join("\r\n")}\r\n`], { type: "text/plain" }));
          const a = document.createElement("a"); a.href = url; a.download = "4core-okr-recovery-codes.txt"; a.click(); URL.revokeObjectURL(url);
        }}>Download as text file</Button>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have saved these codes</label>
      <Button disabled={!saved} onClick={onDone}>Continue</Button>
    </div>
  );
}

export function SecurityPanel({ mfa, mustEnrol }: { mfa: Mfa; mustEnrol: boolean }) {
  return (
    <div className="space-y-6">
      {mustEnrol && !mfa.enrolled ? (
        <Banner tone="warn" title="Set up your authenticator app to continue.">Your role requires a second sign-in step. Until it is set up, the rest of the application is unavailable to you.</Banner>
      ) : null}
      <AuthenticatorCard mfa={mfa} />
      <PasswordCard />
    </div>
  );
}

function AuthenticatorCard({ mfa }: { mfa: Mfa }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const clean = code.replace(/\s/g, "");
  return (
    <Card>
      <CardHeader title="Authenticator app"
        description="A 6-digit code from an app such as Google Authenticator, Microsoft Authenticator or 1Password protects your account even if your password is stolen."
        action={mfa.enrolled ? <Badge tone="done">Active</Badge> : mfa.required ? <Badge tone="critical">Required</Badge> : <Badge tone="undefined">Not set up</Badge>} />
      <div className="space-y-4 px-6 py-4 text-sm">
        {!mfa.enrolled && !enrolment ? (
          <Button disabled={pending}
            onClick={async () => { const r = await run(() => apiRequest<Enrolment>("POST", "auth/mfa/enroll"), { refresh: false }); if (r) setEnrolment(r.value); }}>
            Set up authenticator
          </Button>
        ) : null}

        {enrolment ? (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const ok = await run(() => apiRequest<{ recoveryCodes?: string[] }>("POST", "auth/mfa/verify", { code: clean, factorId: enrolment.factorId }).catch((err: ApiFailure) => { setError(err.message); throw err; }),
              { success: "Authenticator activated.", refresh: false });
            if (ok) { setEnrolment(null); setCode(""); if (ok.value.recoveryCodes?.length) setCodes(ok.value.recoveryCodes); else { router.replace("/dashboard"); router.refresh(); } }
          }}>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Scan this QR code with your authenticator app.
                {/* data: URI from the auth server; shown as an image, never as markup */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enrolment.qrCode} alt="QR code for your authenticator app" width={176} height={176} className="mt-2 rounded border border-line bg-white p-1" />
              </li>
              <li>Cannot scan? Enter this key instead: <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs break-all">{enrolment.secret}</code></li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="max-w-xs">
              <Label htmlFor="enrol-code">Authenticator code</Label>
              <Input id="enrol-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={7} required />
            </div>
            {error ? <p role="alert" className="text-[var(--critical-fg)]">{error}</p> : null}
            <Button type="submit" disabled={pending || clean.length !== 6}>Activate</Button>
          </form>
        ) : null}

        {codes ? <RecoveryCodesDialog codes={codes} onDone={() => { setCodes(null); router.replace("/dashboard"); router.refresh(); }} /> : null}

        {mfa.enrolled && !codes ? (
          <div className="space-y-2 rounded-lg border border-line p-4">
            <h3 className="font-semibold">Recovery codes</h3>
            <p className="text-muted">{(remaining ?? mfa.recoveryCodesRemaining ?? 0) > 0 ? `${remaining ?? mfa.recoveryCodesRemaining} unused code${(remaining ?? mfa.recoveryCodesRemaining) === 1 ? "" : "s"} left.` : "You have no unused recovery codes."} Making new codes cancels the old ones, and asks for a fresh authenticator code.</p>
            <Button variant="secondary" size="sm" disabled={pending}
              onClick={async () => { const r = await run(() => apiRequest<{ recoveryCodes: string[] }>("POST", "auth/mfa/recovery-codes"), { refresh: false }); if (r) { setCodes(r.value.recoveryCodes); setRemaining(r.value.recoveryCodes.length); } }}>
              Make new recovery codes
            </Button>
          </div>
        ) : null}

        {mfa.enrolled && !mfa.required ? (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            await run(() => apiRequest("POST", "auth/mfa/disable", { code: clean }), { success: "Authenticator removed." });
            setCode("");
          }}>
            <p className="text-muted">To remove the authenticator, confirm with a current code.</p>
            <div className="max-w-xs">
              <Label htmlFor="disable-code">Authenticator code</Label>
              <Input id="disable-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={7} />
            </div>
            <Button type="submit" variant="danger" disabled={pending || clean.length !== 6}>Remove authenticator</Button>
          </form>
        ) : null}
        {mfa.enrolled && mfa.required ? <p className="text-muted">Your role requires an authenticator app, so it cannot be removed. If you lose your device, ask an administrator to reset it.</p> : null}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const { run, pending } = useAction();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Change password" description="At least 12 characters with upper and lower case letters and a digit. Your other sessions are signed out." />
      <form className="max-w-sm space-y-4 px-6 py-4 text-sm" onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setError(null);
        if (f.get("next") !== f.get("confirm")) { setError("The two new passwords do not match."); return; }
        const ok = await run(() => apiRequest("POST", "auth/password/change", { currentPassword: f.get("current"), newPassword: f.get("next") })
          .catch((err: ApiFailure) => { setError(err.message); throw err; }), { success: "Password changed.", refresh: false });
        if (ok) form.reset();
      }}>
        <Field id="current" label="Current password"><Input name="current" type="password" autoComplete="current-password" required /></Field>
        <Field id="next" label="New password"><Input name="next" type="password" autoComplete="new-password" minLength={12} required /></Field>
        <Field id="confirm" label="Confirm new password"><Input name="confirm" type="password" autoComplete="new-password" minLength={12} required /></Field>
        {error ? <p role="alert" className="text-[var(--critical-fg)]">{error}</p> : null}
        <Button type="submit" disabled={pending}>Change password</Button>
      </form>
    </Card>
  );
}
