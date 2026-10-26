import { AuthFrame } from "@/components/site/auth-frame";
import { getBranding } from "@/lib/data/branding";
import { getSite } from "@/lib/data/site";

/** Shared frame for sign-in, forgot-password and reset-password. Its layout, wording and picture are set in Administration → Landing & sign-in. */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const [{ config, images }, brand] = await Promise.all([getSite(), getBranding()]);
  return (
    <AuthFrame login={config.login} images={images} brand={{ name: brand.appName, shortName: brand.shortName, logoUrl: brand.logoUrl, primaryColor: brand.primaryColor, logoHeight: brand.logoHeight }}>
      {children}
    </AuthFrame>
  );
}
