import { api, requirePerm } from "@/lib/api/handler";
import { getIntegrations } from "@/lib/data/integrations";
import { encryptionConfigured } from "@/lib/integrations/crypto";
import { allowPrivateHosts } from "@/lib/integrations/ssrf";
import { configuredTransport } from "@/lib/email/transport";

/** What is configured (never a secret), the kinds that can be added, and whether this server can store secrets. */
export const GET = api({}, async ({ actor }) => {
  requirePerm(actor, "integrations.view");
  return { ...(await getIntegrations()), encryptionConfigured: encryptionConfigured(), environmentEmail: configuredTransport()?.name ?? null, privateHostsAllowed: allowPrivateHosts() };
});
