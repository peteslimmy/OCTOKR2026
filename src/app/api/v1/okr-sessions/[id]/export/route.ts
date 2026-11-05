import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { getOutstanding, getWorkspace } from "@/lib/data/session-notes";
import { buildMinutes } from "@/lib/session-notes/minutes";
import { minutesPdf } from "@/lib/session-notes/minutes-pdf";

/**
 * GET /api/v1/okr-sessions/{id}/export?format=pdf&revision= — the session minutes as a PDF: the requested revision, else the latest finalised one, else the latest draft, else the minutes
 * proposed from the records (marked as a draft). Built from what the caller may read (management-only minutes only for those who may), and recorded in the audit log.
 */
export const GET = api({}, async ({ actor, params, req, rpc }) => {
  if (!actor.permissions.has("session_notes.export")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to export session records.");
  const sp = new URL(req.url).searchParams;
  if (!z.literal("pdf").safeParse(sp.get("format") ?? "pdf").success) throw fail("VALIDATION_ERROR", 422, "Minutes are exported as pdf.");
  const ws = await getWorkspace(params.id);
  if (!ws) throw fail("NOT_FOUND", 404, "That record was not found.");
  const wanted = Number(sp.get("revision") ?? "") || null;
  const m = (wanted ? ws.minutes.find((x) => x.revision === wanted) : ws.minutes.find((x) => x.status === "FINALISED") ?? ws.minutes[0]) ?? null;
  if (wanted && !m) throw fail("NOT_FOUND", 404, "That revision was not found.");
  const generatedAt = new Date().toISOString();
  const content = m?.content ?? buildMinutes(ws, { includeManagement: false, generatedOn: generatedAt, outstanding: (await getOutstanding(params.id)) ?? undefined });
  const pdf = await minutesPdf({
    reference: ws.session.reference, revision: m?.revision ?? null, status: m?.status ?? "DRAFT", generatedAt, generatedFor: actor.name, contentHash: m?.content_hash ?? null,
    finalisedBy: m?.finalised_by_name ?? null, finalisedAt: m?.finalised_at ?? null, content, audience: m?.audience ?? "PARTICIPANTS", aiDrafted: m?.ai_drafted ?? false,
  });
  await rpc("record_okr_export", { p_actor: actor.id, p_kind: "SESSION_MINUTES", p_session: params.id, p_format: "PDF", p_params: { revision: m?.revision ?? null, status: m?.status ?? "GENERATED" }, p_rows: 1 });
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="minutes_${ws.session.reference}${m ? `_r${m.revision}` : "_draft"}.pdf"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
});
