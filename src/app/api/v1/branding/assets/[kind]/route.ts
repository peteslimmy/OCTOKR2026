import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { getBranding } from "@/lib/data/branding";

// Only raster images are accepted. SVG is refused on purpose: it can carry scripts.
const LIMITS = { LOGO: 400_000, FAVICON: 100_000 } as const;
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.length > 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "image/x-icon": (b) => b.length > 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
  "image/vnd.microsoft.icon": (b) => b.length > 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
};

const kindOf = (k: string) => { if (k !== "logo" && k !== "favicon") throw fail("NOT_FOUND", 404, "Unknown image."); return k === "logo" ? "LOGO" as const : "FAVICON" as const; };

export const PUT = api(
  { body: z.object({ mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"]), data: z.string().min(8).max(700_000) }) },
  async ({ body, actor, params, rpc }) => {
    const kind = kindOf(params.kind);
    const bytes = Buffer.from(body.data, "base64");
    if (bytes.length > LIMITS[kind]) throw fail("VALIDATION_ERROR", 422, `That image is too large. The ${kind === "LOGO" ? "logo" : "favicon"} can be up to ${Math.round(LIMITS[kind] / 1000)} KB.`);
    if (!SIGNATURES[body.mime](bytes)) throw fail("VALIDATION_ERROR", 422, "The file does not look like the image type it claims to be.");
    await rpc("set_branding_asset", { p_actor: actor.id, p_kind: kind, p_mime: body.mime, p_data_b64: bytes.toString("base64") });
    return getBranding();
  },
);

export const DELETE = api({}, async ({ actor, params, rpc }) => {
  await rpc("clear_branding_asset", { p_actor: actor.id, p_kind: kindOf(params.kind) });
  return getBranding();
});
