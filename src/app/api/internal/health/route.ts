import { NextResponse } from "next/server";
import { healthAlerts, type HealthFigures } from "@/lib/health";
import { rateLimitStore } from "@/lib/auth/rate-limit";
import { resolveEmail } from "@/lib/integrations/runtime";
import { allowPrivateHosts } from "@/lib/integrations/ssrf";
import { jobsSecretMatches } from "@/lib/jobs-secret";
import { adminClient } from "@/lib/supabase/admin";

/** Detailed health for the monitor: the same shared secret as the scheduler. Returns the figures and the alerts that should page someone. */
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!jobsSecretMatches(req.headers.get("x-jobs-secret"))) return NextResponse.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: 401 });
  const { data, error } = await adminClient().rpc("ops_health");
  if (error) return NextResponse.json({ status: "unavailable", alerts: [{ code: "DATABASE_UNAVAILABLE", severity: "critical", message: "The database could not be read." }] }, { status: 503 });
  const figures = data as HealthFigures;
  const mail = await resolveEmail().catch(() => ({ transport: null, source: "none" as const }));
  const alerts = healthAlerts(figures, { production: process.env.NODE_ENV === "production", rateLimitStore: rateLimitStore(), emailTransport: mail.transport ? mail.transport.name : mail.source === "integration" ? "unusable" : "none", privateHostsAllowed: allowPrivateHosts() });
  const worst = alerts.some((a) => a.severity === "critical") ? "alert" : alerts.some((a) => a.severity === "warning") ? "warning" : "ok";
  return NextResponse.json({ status: worst, figures, alerts }, { status: worst === "alert" ? 503 : 200, headers: { "cache-control": "no-store" } });
}
