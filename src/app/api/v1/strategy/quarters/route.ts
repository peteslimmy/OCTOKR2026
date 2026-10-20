import { z } from "zod";
import { api } from "@/lib/api/handler";
import { listQuarters } from "@/lib/data";

export const GET = api({}, async () => listQuarters());

export const POST = api({ body: z.object({ year: z.number().int().min(2000).max(2200) }) }, async ({ actor, body, rpc }) =>
  rpc("create_year_quarters", { p_actor: actor.id, p_year: body.year }));
