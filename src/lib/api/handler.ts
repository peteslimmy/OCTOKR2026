import "server-only";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import pino from "pino";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getActor, type Actor } from "@/lib/auth/actor";
import { hasRecentSecondFactor } from "@/lib/auth/mfa";
import { adminClient } from "@/lib/supabase/admin";
import { hiddenFrom, mentionsHidden, namedIn } from "@/lib/auth/shield";
import { auditHeaders, buildAuditContext, sessionReference } from "@/lib/audit/context";
import { toDomainError, type DomainError } from "@/lib/domain/errors";
import { httpRequestDuration, httpRequestsTotal } from "@/lib/observability/metrics";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  mixin: () => ({ service: "4core-okr" }),
  base: {
    pid: process.pid,
    hostname: hostname(),
  },
});

export class ApiError extends Error {
  /** The database's own message, kept for routes that can safely explain it (never sent to the browser by default). */
  raw?: string;
  constructor(public readonly err: DomainError) {
    super(err.message);
  }
}
export const fail = (code: string, status: number, message: string, details?: unknown) => new ApiError({ code, status, message, details });

export interface Ctx<B = undefined> {
  actor: Actor;
  body: B;
  req: Request;
  params: Record<string, string>;
  correlationId: string;
  /** Executes a service-only RPC as the verified actor. Throws ApiError with a stable domain code. */
  rpc: <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<T>;
}

interface Options<S extends z.ZodObject<z.ZodRawShape> | undefined> {
  /** Request-body schema. Unknown keys are rejected (explicit allowlist, no mass assignment). */
  body?: S;
  /** Skip the authentication requirement (login and similar). */
  public?: boolean;
  /** Allow a session that has not completed (or not yet enrolled in) MFA: only the account/MFA endpoints use this. */
  partial?: boolean;
  /** High-risk action: an enrolled user must have passed a second-factor check (authenticator app or emailed code) in the last 15 minutes (re-prompted by the client). */
  stepUp?: boolean;
}

type RouteCtx = { params: Promise<Record<string, string | string[]>> };

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; cookies are SameSite=Lax so cross-site browsers send an Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function api<S extends z.ZodObject<z.ZodRawShape> | undefined = undefined>(
  opts: Options<S>,
  handler: (c: Ctx<S extends z.ZodObject<z.ZodRawShape> ? z.infer<S> : undefined>) => Promise<unknown>,
) {
  return async (req: Request, routeCtx: RouteCtx): Promise<Response> => {
    const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
    const auditCtx = await buildAuditContext(req, false);
    let sessionRef: string | null = null;     // looked up until found: a sign-in creates the session part-way through the request
    /** The request facts the database stamps on every audit event written during this request (ADR-108). */
    const auditAs = async () => adminClient(correlationId, auditHeaders({ ...auditCtx, sessionRef: (sessionRef ??= await sessionReference()) }));
    const t0 = performance.now();
    const marks: string[] = [];
    const mark = (name: string, since: number) => marks.push(`${name};dur=${(performance.now() - since).toFixed(1)}`);
    const respond = (status: number, payload: unknown) => {
      const res = NextResponse.json(payload, { status });
      marks.push(`total;dur=${(performance.now() - t0).toFixed(1)}`);
      try {
        // the route path with ids collapsed keeps the label set small
        const route = new URL(req.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id");
        httpRequestsTotal.inc({ method: req.method, handler: route, status_code: String(status) });
        httpRequestDuration.observe({ method: req.method, handler: route }, (performance.now() - t0) / 1000);
      } catch { /* metrics never break a request */ }
      res.headers.set("server-timing", marks.join(", ")); // where the time went: visible in the browser's network panel, and to the performance baseline
      res.headers.set("x-correlation-id", correlationId);
      res.headers.set("cache-control", "no-store");
      return res;
    };
    let seen: Actor | null = null;
    try {
      if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) throw fail("PERMISSION_DENIED", 403, "Cross-site request rejected.");
      const tActor = performance.now();
      const actor = await getActor();
      mark("actor", tActor);
      seen = actor;
      if (!actor && !opts.public) throw fail("AUTHENTICATION_REQUIRED", 401, "Please sign in to continue.");
      // a password someone else chose must be replaced first: nothing but the sign-in and password routes works until then
      if (actor?.mustChangePassword && !opts.public && !new URL(req.url).pathname.startsWith("/api/v1/auth/")) throw fail("PASSWORD_CHANGE_REQUIRED", 403, "Choose a new password before continuing.");
      if (actor && !opts.public && !opts.partial) {
        if (actor.mfa.required && !actor.mfa.enrolled) throw fail("MFA_ENROLMENT_REQUIRED", 403, "Your role requires a second factor. Set one up under Account security.");
        if (actor.mfa.enrolled && actor.mfa.aal !== "aal2") throw fail("MFA_REQUIRED", 401, "Enter your authenticator or email code to continue.");
      }
      if (actor && opts.stepUp && actor.mfa.enrolled && !(await hasRecentSecondFactor())) {
        throw fail("STEP_UP_REQUIRED", 401, "Confirm with your authenticator or email code to continue.");
      }

      let body: unknown = undefined;
      if (opts.body) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          throw fail("VALIDATION_ERROR", 422, "The request body must be valid JSON.");
        }
        const parsed = (opts.body as unknown as z.ZodObject<z.ZodRawShape>).strict().safeParse(raw);
        if (!parsed.success) {
          throw fail("VALIDATION_ERROR", 422, "Some of the information provided is not valid.",
            parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
        }
        body = parsed.data;
      }
      const raw = await routeCtx.params;
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw ?? {})) params[k] = Array.isArray(v) ? v.join("/") : v;

      // a request that names a Super Admin's account, employee record or address is answered "not found" for everyone who is not a Super Admin (ADR-118)
      if (actor && !opts.public) {
        const named = namedIn([params, body, Object.fromEntries(new URL(req.url).searchParams)]);
        if (named.size && mentionsHidden(named, await hiddenFrom(actor))) throw fail("NOT_FOUND", 404, "That record was not found.");
      }

      const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
        const { data, error } = await (await auditAs()).rpc(fn, args);
        if (error) { const e = new ApiError(toDomainError(error)); e.raw = error.message; throw e; }
        return data as T;
      };
      const tHandler = performance.now();
      const out = await handler({ actor: actor as Actor, body: body as never, req, params, correlationId, rpc });
      mark("handler", tHandler);
      if (out instanceof Response) return out;
      return respond(200, { data: out ?? null, correlationId });
    } catch (e) {
      if (e instanceof ApiError && seen && (e.err.code === "PERMISSION_DENIED" || e.err.code === "BU_SCOPE_DENIED")) {
        // a refusal of a signed-in person is kept as evidence; recording it must never change the answer they get
        const route = new URL(req.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
        await (await auditAs()).rpc("record_access_denied", { p_actor: seen.id, p_method: req.method, p_route: route, p_code: e.err.code }).then(() => undefined, () => undefined);
      }
      if (e instanceof ApiError) await recordSecurityRefusal(e, req, seen, opts.public === true, auditAs);
      if (e instanceof ApiError) return respond(e.err.status, { error: { code: e.err.code, message: e.err.message, details: e.err.details, correlationId } });
      logger.error({ correlationId, error: e }, "Unhandled error in API handler");
      return respond(500, { error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Nothing was changed; please try again.", correlationId } });
    }
  };
}

const REFUSALS: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "SECURITY_AUTH_REQUIRED", MFA_REQUIRED: "SECURITY_MFA_REQUIRED", MFA_ENROLMENT_REQUIRED: "SECURITY_MFA_REQUIRED",
  STEP_UP_REQUIRED: "SECURITY_STEP_UP_REQUIRED", RATE_LIMITED: "SECURITY_RATE_LIMITED",
};
/**
 * Refusals that never reach a business function (no sign-in, second factor missing, cross-site request, rate limit) are kept as evidence too.
 * Repeats from the same address and route within five minutes collapse into one record. Recording never changes the answer the caller gets.
 */
async function recordSecurityRefusal(e: ApiError, req: Request, seen: Actor | null, isPublic: boolean, auditAs: () => Promise<ReturnType<typeof adminClient>>) {
  try {
    const crossSite = e.err.code === "PERMISSION_DENIED" && e.err.message.startsWith("Cross-site");
    const action = crossSite ? "SECURITY_CROSS_SITE_REJECTED" : REFUSALS[e.err.code];
    if (!action) return;
    const path = new URL(req.url).pathname;
    if (path === "/api/v1/auth/me" || (isPublic && e.err.code === "AUTHENTICATION_REQUIRED")) return;     // polling for "am I signed in" is not a refusal
    const route = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
    await (await auditAs()).rpc("record_security_event", {
      p_actor: seen?.id ?? null, p_action: action, p_outcome: "DENIED", p_entity_type: "route", p_entity_id: route,
      p_meta: { method: req.method, code: e.err.code }, p_collapse_seconds: 300,
    });
  } catch { /* evidence is best-effort here; it must never break the response */ }
}

/** Permission gate for route handlers (the RPC re-checks; this gives a fast, uniform 403). */
export function requirePerm(actor: Actor, code: string) {
  if (!actor.permissions.has(code)) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
}