import { getSiteImage } from "@/lib/data/site";

/** An image used on the landing page or sign-in screens, served to everyone. ?v= changes with the image, so it can be cached for a year. */
export async function GET(_req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slot)) return new Response("Not found", { status: 404 });
  const img = await getSiteImage(slot);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: { "content-type": img.mime, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
}
