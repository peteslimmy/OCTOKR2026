import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { contrastWithWhite, MIN_CONTRAST } from "@/lib/branding-theme";
import { getBranding } from "@/lib/data/branding";

export const GET = api({}, async () => getBranding());

/** Name, short mark and colour. The colour carries white text (buttons, badges), so it must keep a readable contrast (WCAG AA, 4.5:1). */
export const PUT = api(
  { body: z.object({ appName: z.string().trim().min(1).max(60), shortName: z.string().trim().min(1).max(3), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }) },
  async ({ body, actor, rpc }) => {
    if (contrastWithWhite(body.primaryColor) < MIN_CONTRAST) throw fail("VALIDATION_ERROR", 422, `That colour is too light for white text (contrast ${contrastWithWhite(body.primaryColor).toFixed(1)}:1, needs ${MIN_CONTRAST}:1). Choose a darker one.`);
    await rpc("set_branding", { p_actor: actor.id, p_app_name: body.appName, p_short_name: body.shortName, p_primary_color: body.primaryColor });
    return getBranding();
  },
);
