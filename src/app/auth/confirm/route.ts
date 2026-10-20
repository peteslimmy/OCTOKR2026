import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";

/** Landing point of the password-reset email link: exchanges the one-time token for a short recovery session. */
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const type = req.nextUrl.searchParams.get("type");
  const to = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin));
  if (!tokenHash || type !== "recovery") return to("/forgot-password?expired=1");
  const sb = await userClient();
  const { error } = await sb.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  return error ? to("/forgot-password?expired=1") : to("/reset-password");
}
