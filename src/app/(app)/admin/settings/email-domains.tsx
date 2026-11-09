"use client";

import { useState } from "react";
import { apiRequest, ConfirmButton, useAction } from "@/components/ui/client";
import { Button, Input } from "@/components/ui/primitives";

const PUBLIC_PROVIDERS = ["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "protonmail.com", "aol.com"];

export function EmailDomains({ domains }: { domains: string[] }) {
  const [domain, setDomain] = useState("");
  const { run, pending } = useAction();
  return (
    <div className="space-y-4 px-6 py-4 text-sm">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {domains.map((d) => (
          <li key={d} className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="font-mono">@{d}</span>
            <ConfirmButton label="Remove" variant="secondary" title={`Remove ${d}`} description="Nobody new can be added with this domain. It cannot be removed while active people still use it."
              onConfirm={() => run(() => apiRequest("POST", "email-domains", { domain: d, add: false }), { success: "Domain removed." })} />
          </li>
        ))}
        {domains.length === 0 ? <li className="px-4 py-2 text-muted">No domains approved: only a Super Admin can add people.</li> : null}
      </ul>
      <p className="max-w-md text-xs text-muted">Approve a domain so Admins can add people on it. A Super Admin can add a person on any address without approving it. A public mail provider (gmail.com, outlook.com and the like) can be approved when it is needed, but then Admins can add anyone with an address there, so remove it again when you no longer need it.</p>
      <form className="flex max-w-md gap-2" onSubmit={async (e) => { e.preventDefault(); const d = domain.replace(/^@/, "").trim().toLowerCase(); if (PUBLIC_PROVIDERS.includes(d) && !window.confirm(`@${d} is a public mail provider. Once approved, Admins can add anyone with an @${d} address. Approve it?`)) return; const ok = await run(() => apiRequest("POST", "email-domains", { domain: domain.replace(/^@/, ""), add: true }), { success: "Domain approved." }); if (ok) setDomain(""); }}>
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" aria-label="Email domain" required />
        <Button type="submit" disabled={pending || !domain.trim()}>Approve domain</Button>
      </form>
    </div>
  );
}
