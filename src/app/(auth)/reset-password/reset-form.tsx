"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, ApiFailure } from "@/components/ui/client";
import { Button, Card, Input, Label } from "@/components/ui/primitives";

type Status = { enrolled: boolean; aal: string };

export function ResetForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | "none" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<Status>("GET", "auth/mfa/status").then(setStatus).catch(() => setStatus("none"));
  }, []);

  if (status === null) return <Card className="p-6"><p className="text-sm text-muted">Checking your reset link…</p></Card>;
  if (status === "none") {
    return (
      <Card className="p-6">
        <p role="alert" className="text-sm">This reset link is invalid or has expired.</p>
        <p className="mt-3 text-sm"><Link href="/forgot-password" className="text-brand-700 underline">Request a new link</Link></p>
      </Card>
    );
  }
  // users with an authenticator must prove it before the password can change
  if (status.enrolled && status.aal !== "aal2") {
    return (
      <Card className="p-6">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await apiRequest("POST", "auth/mfa/verify", { code: String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "") });
              setStatus({ ...status, aal: "aal2" });
            } catch (err) {
              setError((err as ApiFailure).message);
            }
            setBusy(false);
          }}
        >
          <div>
            <Label htmlFor="code">Authenticator code</Label>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Verifying…" : "Verify"}</Button>
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
          const f = new FormData(e.currentTarget);
          if (f.get("password") !== f.get("confirm")) { setError("The two passwords do not match."); return; }
          setBusy(true);
          setError(null);
          try {
            await apiRequest("POST", "auth/password/reset", { password: f.get("password") });
            router.replace("/login?reset=1");
            router.refresh();
          } catch (err) {
            setError((err as ApiFailure).message);
            setBusy(false);
          }
        }}
      >
        <div>
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
        </div>
        {error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button>
      </form>
    </Card>
  );
}
