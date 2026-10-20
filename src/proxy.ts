import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = ["/login", "/forgot-password", "/reset-password", "/auth/confirm", "/branding", "/site-image"];

/** Content-Security-Policy with a per-request nonce (ADR-052). Scripts run only if they carry the nonce; nothing else is allowed to load or be framed. */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonce-approved Next.js runtime load its own chunks. Dev needs eval for hot reload only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // style attributes are used by the UI (progress bars, widths); styles cannot execute code
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // the browser talks only to this origin: all data goes through the API routes
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Refreshes the Supabase session cookie, gates pages and sets the CSP. The page gate is a convenience redirect only:
 * every API route and data read independently authenticates and authorises (ADR-035).
 */
export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const isLanding = path === "/";   // the public landing page; signed-in users go straight to their dashboard
  const isPublic = isLanding || PUBLIC_PAGES.some((p) => path === p || path.startsWith(p + "/"));
  const redirect = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    const r = NextResponse.redirect(url);
    r.headers.set("content-security-policy", csp);
    return r;
  };
  if (!data.user && !isApi && !isPublic) return redirect("/login");
  if (data.user && isLanding) return redirect("/dashboard");
  // a half-signed-in session (password done, authenticator pending) is sent back to /login?mfa=1: do not bounce it away again
  if (data.user && path === "/login" && !request.nextUrl.searchParams.has("mfa")) return redirect("/dashboard");
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|ico|webp)$).*)"] };
