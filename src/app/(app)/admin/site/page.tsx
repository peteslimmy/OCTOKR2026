import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getBranding } from "@/lib/data/branding";
import { getSite } from "@/lib/data/site";
import { SiteEditor } from "./site-editor";

export const metadata: Metadata = { title: "Landing & sign-in" };

export default async function SitePage() {
  const actor = await requireActor();
  if (!can(actor, "branding.manage")) return <Card><EmptyState title="This page is not available for your role" /></Card>;
  const [site, brand] = await Promise.all([getSite(), getBranding()]);
  return (
    <>
      <PageHeader title="Landing page & sign-in screens" description="Change the words, sections, links and pictures of the public home page and of the sign-in, forgot-password and reset-password screens. A live preview updates as you type; nothing reaches the live pages until you save." />
      <SiteEditor initial={site.config} versions={site.images} brand={{ name: brand.appName, shortName: brand.shortName, logoUrl: brand.logoUrl, primaryColor: brand.primaryColor, logoHeight: brand.logoHeight }} />
    </>
  );
}
