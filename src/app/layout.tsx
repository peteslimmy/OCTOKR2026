import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/client";
import { themeCss } from "@/lib/branding-theme";
import { getBranding } from "@/lib/data/branding";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// The name, favicon and colour come from Administration → Branding.
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return {
    title: { default: b.appName, template: `%s · ${b.appName}` },
    description: "Strategic execution, weekly accountability and governance.",
    ...(b.faviconUrl ? { icons: { icon: b.faviconUrl } } : {}),
  };
}

// Every page is rendered per request: the Content-Security-Policy nonce (proxy.ts) can only be applied to dynamically rendered HTML.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const brand = await getBranding();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head><style dangerouslySetInnerHTML={{ __html: themeCss(brand.primaryColor) }} /></head>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
