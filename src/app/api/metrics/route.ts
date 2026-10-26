import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { register } from "@/lib/observability/metrics";

/**
 * Prometheus scrape endpoint. Operational figures are not public: a bearer token (METRICS_TOKEN) is required.
 * With no token configured the endpoint is open only outside production, so local development still works.
 */
function authorised(req: Request): boolean {
  const token = process.env.METRICS_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorised(req)) return new NextResponse("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  try {
    const metrics = await register.metrics();
    return new NextResponse(metrics, {
      headers: {
        "Content-Type": register.contentType,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error generating metrics:", error);
    return new NextResponse("Error generating metrics", { status: 500 });
  }
}
