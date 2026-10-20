import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getActor, type Actor } from "@/lib/auth/actor";
import { hasRecentTotp } from "@/lib/auth/mfa";
import { adminClient } from "@/lib/supabase/admin";
import { toDomainError, type DomainError } from "@/lib/domain/errors";

export class ApiError extends Error {
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
  /** High-risk action: an enrolled user must have passed a TOTP check in the last 15 minutes (re-prompted by the client). */
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
    const t0 = performance.now();
    const marks: string[] = [];
    const mark = (name: string, since: number) => marks.push(`${name};dur=${(performance.now() - since).toFixed(1)}`);
    const respond = (status: number, payload: unknown) => {
      const res = NextResponse.json(payload, { status });
      marks.push(`total;dur=${(performance.now() - t0).toFixed(1)}`);
      res.headers.set("server-timing", marks.join(", "));         // where the time went: visible in the browser's network panel, and to the performance baseline
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
      if (actor && !opts.public && !opts.partial) {
        if (actor.mfa.required && !actor.mfa.enrolled) throw fail("MFA_ENROLMENT_REQUIRED", 403, "Your role requires an authenticator app. Set one up under Account security.");
        if (actor.mfa.enrolled && actor.mfa.aal !== "aal2") throw fail("MFA_REQUIRED", 401, "Enter your authenticator code to continue.");
      }
      if (actor && opts.stepUp && actor.mfa.enrolled && !(await hasRecentTotp())) {
        throw fail("STEP_UP_REQUIRED", 401, "Confirm with your authenticator code to continue.");
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

      const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
        const { data, error } = await adminClient(correlationId).rpc(fn, args);
        if (error) throw new ApiError(toDomainError(error));
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
        await adminClient(correlationId).rpc("record_access_denied", { p_actor: seen.id, p_method: req.method, p_route: route, p_code: e.err.code }).then(() => undefined, () => undefined);
      }
      if (e instanceof ApiError) return respond(e.err.status, { error: { code: e.err.code, message: e.err.message, details: e.err.details, correlationId } });
      console.error(`[${correlationId}] unhandled`, e);
      return respond(500, { error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Nothing was changed; please try again.", correlationId } });
    }
  };
}

/** Permission gate for route handlers (the RPC re-checks; this gives a fast, uniform 403). */
export function requirePerm(actor: Actor, code: string) {
  if (!actor.permissions.has(code)) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
}
