import type { Metadata } from "next";
import Link from "next/link";
import { Banner, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getIntegrations } from "@/lib/data/integrations";
import { configuredTransport } from "@/lib/email/transport";
import { encryptionConfigured } from "@/lib/integrations/crypto";
import { allowPrivateHosts } from "@/lib/integrations/ssrf";
import { IntegrationsManager } from "./integrations-manager";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const actor = await requireActor();
  if (!can(actor, "integrations.view")) return <Card><EmptyState title="Integrations are not available for your role" /></Card>;
  const { kinds, items } = await getIntegrations();
  const envMail = configuredTransport()?.name ?? null;
  const emailInUse = items.some((i) => i.slot === "EMAIL" && i.enabled);
  return (
    <>
      <PageHeader title="Integrations" description="Connect email, an AI provider or other systems here instead of in server files. A change is asked for by one person and approved by a Super Admin; secrets are encrypted and never shown again."
        actions={<Link href="/admin/approvals" className={buttonClass("secondary", "sm")}>Approvals</Link>} />
      <div className="space-y-6">
        {envMail && !emailInUse ? <Banner tone="info" title="Email is currently set in the server's files">Mail goes out through <code>{envMail}</code> from the server&apos;s environment. An email service enabled here takes over from it.</Banner> : null}
        {allowPrivateHosts() ? <Banner tone="warn" title="Internal addresses are allowed">INTEGRATIONS_ALLOW_PRIVATE_HOSTS is on, so integrations may call addresses inside your network. This is for development only.</Banner> : null}
        <IntegrationsManager kinds={kinds} items={items} canConfigure={can(actor, "integrations.configure")} canTest={can(actor, "integrations.test")} canApplyNow={can(actor, "config.emergency")} encryptionConfigured={encryptionConfigured()} />
      </div>
    </>
  );
}
