"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, ApiFailure } from "@/components/ui/client";
import { Button, Card, Field, Input } from "@/components/ui/primitives";

export function ChangeForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-6">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError(null);
        if (f.get("next") !== f.get("confirm")) { setError("The two new passwords do not match."); return; }
        setBusy(true);
        try {
          await apiRequest("POST", "auth/password/change", { currentPassword: f.get("current"), newPassword: f.get("next") });
          router.replace("/dashboard");
          router.refresh();
        } catch (err) { setError((err as ApiFailure).message); setBusy(false); }
      }}>
        <Field id="current" label="Password you were given"><Input name="current" type="password" autoComplete="current-password" required /></Field>
        <Field id="next" label="New password"><Input name="next" type="password" autoComplete="new-password" minLength={12} required /></Field>
        <Field id="confirm" label="Confirm new password"><Input name="confirm" type="password" autoComplete="new-password" minLength={12} required /></Field>
        {error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Saving…" : "Save and continue"}</Button>
      </form>
    </Card>
  );
}
