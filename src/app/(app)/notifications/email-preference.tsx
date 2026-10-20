"use client";

import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Card } from "@/components/ui/primitives";

/** The person's own choice about non-security email. Security emails (password, authenticator, break-glass, emergency reversal) are always sent. */
export function EmailPreference({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const { run, pending } = useAction();
  return (
    <Card className="mb-4 p-4">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1" checked={on} disabled={pending}
          onChange={async (e) => {
            const next = e.target.checked;
            setOn(next);                                                   // shown at once; put back if the save fails
            const ok = await run(() => apiRequest("PUT", "notification-preferences", { emailEnabled: next }), { success: next ? "You will get email about time-sensitive events." : "Email turned off for routine events.", refresh: false });
            if (!ok) setOn(!next);
          }} />
        <span><span className="font-medium">Email me about time-sensitive events</span>
          <span className="block text-muted">Report reminders, approvals waiting for you and similar. Security messages (password, authenticator, break-glass, emergency reversals) are always sent. Everything also appears here.</span></span>
      </label>
    </Card>
  );
}
