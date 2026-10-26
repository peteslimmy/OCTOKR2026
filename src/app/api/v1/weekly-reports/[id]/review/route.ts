import { api } from "@/lib/api/handler";
import { z } from "zod";

// Either a review (optional comments) or a rejection (mandatory reason); never both.
export const POST = api(
  {
    body: z.object({ comments: z.string().max(2000).optional(), rejection_reason: z.string().max(2000).optional() })
      .refine((b) => !(b.rejection_reason !== undefined && b.comments), { message: "Send comments or a rejection reason, not both" }),
  },
  async ({ actor, params, body, rpc }) => {
    if (body.rejection_reason !== undefined) {
      return rpc("reject_weekly_report", { p_actor: actor.id, p_report_id: params.id, p_reason: body.rejection_reason });
    }
    return rpc("review_weekly_report", { p_actor: actor.id, p_report_id: params.id, p_comments: body.comments ?? null });
  }
);
