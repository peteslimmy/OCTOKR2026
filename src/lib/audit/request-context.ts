import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditContext } from "./context";

/**
 * The audit context of the request being handled (address, location, user agent, request id), kept for the whole request so that EVERY audited write made while handling it carries it,
 * including writes made by server code that talks to the database directly rather than through the request helper (ADR-121).
 */
export const requestAudit = new AsyncLocalStorage<AuditContext>();
