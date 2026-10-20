import { api, fail } from "@/lib/api/handler";

export const GET = api({}, async ({ actor, req, rpc }) => {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId");
  const target = url.searchParams.get("target");
  if (!taskId || (target !== "DONE" && target !== "NOT_DONE")) throw fail("VALIDATION_ERROR", 422, "taskId and target are required.");
  return rpc("integrity_correction_preview", { p_actor: actor.id, p_task_id: taskId, p_target: target });
});
