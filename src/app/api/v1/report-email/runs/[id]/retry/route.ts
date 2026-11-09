import { api, fail } from "@/lib/api/handler";
import { dispatchRun } from "@/lib/report-email/service";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Re-sends only the failed deliveries of a run. Recipients who already received it are not mailed again. */
export const POST = api({}, async ({ actor, params, rpc }) => {
  if (!uuid.test(params.id)) throw fail("NOT_FOUND", 404, "That run was not found.");
  const queued = await rpc<number>("retry_report_email_run", { p_actor: actor.id, p_run: params.id });
  if (queued === 0) return { retried: 0, status: "NOTHING_TO_RETRY" };
  const out = await dispatchRun(params.id, rpc);
  return { retried: queued, ...out };
});
