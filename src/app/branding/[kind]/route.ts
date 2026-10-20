import { getBrandingAsset } from "@/lib/data/branding";

/** The logo and favicon, served to everyone (they appear on the sign-in page). The ?v= query changes whenever the image does, so it can be cached for a year. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "logo" && kind !== "favicon") return new Response("Not found", { status: 404 });
  const asset = await getBrandingAsset(kind === "logo" ? "LOGO" : "FAVICON");
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.bytes), {
    headers: { "content-type": asset.mime, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
}
