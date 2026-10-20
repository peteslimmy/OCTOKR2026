import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getBranding } from "@/lib/data/branding";
import { BrandingForm } from "./branding-form";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingPage() {
  const actor = await requireActor();
  if (!can(actor, "branding.manage")) return <Card><EmptyState title="Branding is not available for your role" /></Card>;
  const b = await getBranding();
  return (
    <>
      <PageHeader title="Branding" description="The name, logo, favicon and main colour used across the application and the sign-in page. Changes apply at once and are recorded in the audit log." />
      <Card>
        <CardHeader title="Look and feel" description="Use a PNG, JPEG or WebP logo (up to 400 KB) and a PNG or ICO favicon (up to 100 KB). Square images work best." />
        <BrandingForm initial={{ appName: b.appName, shortName: b.shortName, primaryColor: b.primaryColor, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl }} />
      </Card>
    </>
  );
}
