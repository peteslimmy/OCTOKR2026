import "server-only";
import { DEFAULT_PRIMARY } from "@/lib/branding-theme";
import { userClient } from "@/lib/supabase/server";

export interface Branding {
  appName: string; shortName: string; primaryColor: string;
  logoUrl: string | null; faviconUrl: string | null; logoVersion: number; faviconVersion: number;
}

export const DEFAULT_BRANDING: Branding = { appName: "4CORE-OKR", shortName: "4", primaryColor: DEFAULT_PRIMARY, logoUrl: null, faviconUrl: null, logoVersion: 0, faviconVersion: 0 };

/** Readable without signing in: the name and logo are on the sign-in page. Falls back to the defaults if the table cannot be read. */
export async function getBranding(): Promise<Branding> {
  try {
    const sb = await userClient();
    const { data } = await sb.from("app_branding").select("app_name, short_name, primary_color, logo_version, favicon_version").maybeSingle();
    if (!data) return DEFAULT_BRANDING;
    return {
      appName: data.app_name, shortName: data.short_name, primaryColor: data.primary_color,
      logoVersion: data.logo_version, faviconVersion: data.favicon_version,
      logoUrl: data.logo_version > 0 ? `/branding/logo?v=${data.logo_version}` : null,
      faviconUrl: data.favicon_version > 0 ? `/branding/favicon?v=${data.favicon_version}` : null,
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

export async function getBrandingAsset(kind: "LOGO" | "FAVICON"): Promise<{ mime: string; bytes: Buffer } | null> {
  const sb = await userClient();
  const { data } = await sb.from("app_branding_assets").select("mime, data_b64").eq("kind", kind).maybeSingle();
  return data ? { mime: data.mime, bytes: Buffer.from(data.data_b64, "base64") } : null;
}
