import { z } from "zod";
import { api, requirePerm } from "@/lib/api/handler";
import { explaining } from "@/lib/import/history-route";

/** Strategy import, step 2: writes every quarter in one transaction. Super Admin tier only, fresh authenticator code, typed confirmation. */
const row = z.object({ row_no: z.number().int(), year: z.number().int(), quarter: z.number().int(), objective: z.string().max(1000), kr_no: z.number().int(), kr_title: z.string().max(1000), sub_no: z.number().int(), sub_title: z.string().max(1000) }).strict();
export const POST = api({ stepUp: true, body: z.object({ rows: z.array(row).min(1).max(2000), fileName: z.string().trim().min(1).max(255), fileSha256: z.string().regex(/^[0-9a-f]{64}$/), confirm: z.string().max(40) }) },
  async ({ actor, body, rpc }) => {
    requirePerm(actor, "strategy.import");
    return explaining("The strategy import", () => rpc("strategy_import_commit", { p_actor: actor.id, p_rows: body.rows, p_file: body.fileName, p_sha: body.fileSha256, p_confirm: body.confirm }));
  });
