import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { IMAGE_LIMIT_BYTES } from "@/lib/site-content";

// Raster images only. SVG is refused on purpose: it can carry scripts.
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.length > 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};
const slotOf = (s: string) => { if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(s)) throw fail("VALIDATION_ERROR", 422, "That image name is not valid."); return s; };

export const PUT = api({ body: z.object({ mime: z.enum(["image/png", "image/jpeg", "image/webp"]), data: z.string().min(8).max(2_800_000) }) }, async ({ body, actor, params, rpc }) => {
  const slot = slotOf(params.slot);
  const bytes = Buffer.from(body.data, "base64");
  if (bytes.length > IMAGE_LIMIT_BYTES) throw fail("VALIDATION_ERROR", 422, `That image is too large. Images can be up to ${Math.round(IMAGE_LIMIT_BYTES / 1_000_000)} MB.`);
  if (!SIGNATURES[body.mime](bytes)) throw fail("VALIDATION_ERROR", 422, "The file does not look like the image type it claims to be.");
  const version = await rpc<number>("set_site_image", { p_actor: actor.id, p_slot: slot, p_mime: body.mime, p_data_b64: bytes.toString("base64") });
  return { slot, version };
});

export const DELETE = api({}, async ({ actor, params, rpc }) => { await rpc("delete_site_image", { p_actor: actor.id, p_slot: slotOf(params.slot) }); return { slot: params.slot }; });
