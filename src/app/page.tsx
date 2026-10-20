import type { Metadata } from "next";
import { LandingView } from "@/components/site/landing-view";
import { getBranding } from "@/lib/data/branding";
import { getSite } from "@/lib/data/site";

// Everything on this page (words, links, sections, pictures) is edited in Administration → Landing & sign-in.
export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getSite();
  return { title: config.landing.hero.headline, description: config.landing.hero.subheadline };
}

export default async function Home() {
  const [{ config, images }, brand] = await Promise.all([getSite(), getBranding()]);
  return <LandingView config={config.landing} images={images} brand={{ name: brand.appName, shortName: brand.shortName, logoUrl: brand.logoUrl, primaryColor: brand.primaryColor }} />;
}
