import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { requireActor } from "@/lib/auth/actor";
import { userClient } from "@/lib/supabase/server";
import { SecurityPanel } from "./security-panel";

export const metadata: Metadata = { title: "Account security" };

export default async function AccountSecurityPage({ searchParams }: PageProps<"/account/security">) {
  // reachable by a password-only session on purpose: this is where an elevated user who has no authenticator yet must go
  const actor = await requireActor({ partial: true });
  const sp = await searchParams;
  const sb = await userClient();
  const { data: rec } = await sb.rpc("read_my_recovery_status");
  return (
    <>
      <PageHeader title="Account security" description={`${actor.email} — your password and authenticator app.`} />
      <SecurityPanel mfa={{ ...actor.mfa, recoveryCodesRemaining: (rec as { remaining?: number } | null)?.remaining ?? 0 }} mustEnrol={sp.enrol === "1"} />
    </>
  );
}
