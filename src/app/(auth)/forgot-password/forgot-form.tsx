"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiRequest, ApiFailure } from "@/components/ui/client";
import { Button, Card, Input, Label } from "@/components/ui/primitives";

export function ForgotForm() {
  const expired = useSearchParams().get("expired");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (sent) {
    return (
      <Card className="p-6">
        <p role="status" className="text-sm">If an account exists for that address, a reset link is on its way. It works once and expires in one hour.</p>
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
          try {
            await apiRequest("POST", "auth/password/forgot", { email: new FormData(e.currentTarget).get("email") });
            setSent(true);
          } catch (err) {
            setError((err as ApiFailure).message);
            setBusy(false);
          }
        }}
      >
        {expired ? <p role="alert" className="text-sm text-[var(--critical-fg)]">That reset link is invalid or has expired. Request a new one.</p> : null}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        {error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
      </form>
    </Card>
  );
}
