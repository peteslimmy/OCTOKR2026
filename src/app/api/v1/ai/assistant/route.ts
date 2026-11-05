import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { ask, AssistantUnavailable } from "@/lib/ai/ask";

/** POST /api/v1/ai/assistant { question, conversationId? } — one question to 4COREPAL. A refusal (provider down, budget reached) is a normal answer with ok:false, not an error. */
export const POST = api({ body: z.object({ question: z.string().min(1).max(2000), conversationId: z.string().uuid().optional() }) }, async ({ actor, body }) => {
  try { return await ask(actor, body); }
  catch (e) {
    if (e instanceof AssistantUnavailable) throw e.code === "AI_DISABLED" ? fail("AI_DISABLED", 403, "The AI Performance Agent is not switched on.") : e.code === "NOT_FOUND" ? fail("NOT_FOUND", 404, "That conversation was not found.") : fail("PERMISSION_DENIED", 403, "You do not have access to the assistant.");
    throw e;
  }
});
