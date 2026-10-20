import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Liveness for load balancers and uptime monitors. Public, so it says only whether the application can use its database and is safe to serve;
 * details are in /api/internal/health behind the shared secret.
 */
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { data, error } = await adminClient().rpc("ops_health");
    if (error) throw new Error(error.message);
    const unsafe = process.env.NODE_ENV === "production" && data?.clock_override_present === true;
    return NextResponse.json({ status: unsafe ? "degraded" : "ok" }, { status: unsafe ? 503 : 200, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
