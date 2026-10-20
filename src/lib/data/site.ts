import "server-only";
import { resolveSite, type SiteConfig } from "@/lib/site-content";
import { userClient } from "@/lib/supabase/server";

export interface SiteView { config: SiteConfig; version: number; images: Record<string, number> }

/** Readable without signing in: the landing page and the sign-in screens use it. Falls back to the built-in content if it cannot be read. */
export async function getSite(): Promise<SiteView> {
  try {
    const sb = await userClient();
    const [content, imgs] = await Promise.all([
      sb.from("site_content").select("landing, login, version").maybeSingle(),
      sb.from("site_images").select("slot, version"),
    ]);
    return {
      config: resolveSite(content.data), version: content.data?.version ?? 0,
      images: Object.fromEntries((imgs.data ?? []).map((i: { slot: string; version: number }) => [i.slot, i.version])),
    };
  } catch {
    return { config: resolveSite(null), version: 0, images: {} };
  }
}

export async function getSiteImage(slot: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const sb = await userClient();
  const { data } = await sb.from("site_images").select("mime, data_b64").eq("slot", slot).maybeSingle();
  return data ? { mime: data.mime, bytes: Buffer.from(data.data_b64, "base64") } : null;
}
