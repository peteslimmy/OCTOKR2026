import type { Actor } from "@/lib/auth/actor";

/**
 * What the signed-in person's role lets the screen offer. This only decides which buttons are drawn: every action is checked again by the API and, finally, by the database
 * (permission, unit scope, authorship, state). A hidden button is never the protection.
 */
export function eoCaps(actor: Pick<Actor, "id" | "buId" | "permissions">) {
  const c = (p: string) => actor.permissions.has(p);
  return {
    viewerId: actor.id, viewerBu: actor.buId,
    viewComments: c("executive_comment.view"), viewRecs: c("executive_recommendation.view"),
    comment: c("executive_comment.create"), reply: c("executive_comment.reply"), amend: c("executive_comment.amend"),
    recommend: c("executive_recommendation.create"), withdraw: c("executive_recommendation.withdraw"), close: c("executive_recommendation.close"),
    respond: c("executive_recommendation.respond"), progress: c("executive_recommendation.update_progress"),
    dashboard: c("executive_oversight.dashboard.view"), viewAll: c("executive_oversight.view_all"), exportOk: c("executive_oversight.export"), configure: c("executive_oversight.configure"),
  };
}
export type EoCaps = ReturnType<typeof eoCaps>;
