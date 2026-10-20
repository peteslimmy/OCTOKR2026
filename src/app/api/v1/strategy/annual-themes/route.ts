import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ year: z.number().int().min(2000).max(2200), theme: z.string().trim().min(1).max(500) }) }, async ({ actor, body, rpc }) =>
  rpc("create_annual_theme", { p_actor: actor.id, p_year: body.year, p_theme: body.theme }));
