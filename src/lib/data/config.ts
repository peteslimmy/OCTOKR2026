import "server-only";
import { userClient } from "@/lib/supabase/server";
import { dbError } from "./errors";

export interface ConfigChangeRow {
  id: string; topic: string; topic_description: string; target: string | null; proposed: Record<string, unknown>; current_value: Record<string, unknown> | null;
  reason: string; status: "PENDING" | "APPLIED" | "REJECTED" | "WITHDRAWN"; emergency: boolean; requested_by: string; requested_by_name: string;
  decided_by: string | null; decided_by_name: string | null; decided_at: string | null; decision_comment: string | null; created_at: string; topic_protected: boolean;
}

export async function listConfigChanges(limit = 100): Promise<ConfigChangeRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_config_changes", { p_limit: limit });
  if (error) throw dbError(error, "configuration changes");
  return (data as ConfigChangeRow[]) ?? [];
}

export interface RoleRow { id: string; code: string; name: string; description: string | null; is_system: boolean; privileged: boolean; requires_mfa: boolean; members: number; permissions: string[] }
export interface PermissionRow { code: string; description: string; protected: boolean; reserved?: boolean }

export async function listRoles(): Promise<RoleRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_roles");
  if (error) throw dbError(error, "roles");
  return (data as RoleRow[]) ?? [];
}

export async function listPermissions(): Promise<PermissionRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_permissions");
  if (error) throw dbError(error, "permissions");
  return (data as PermissionRow[]) ?? [];
}

export interface LockScheduleView { active: import("@/lib/domain/schedule").LockSchedule & { id: string; reason: string | null; created_at: string };
  history: (import("@/lib/domain/schedule").LockSchedule & { id: string; reason: string | null; created_at: string })[]; first_affected_week: string | null; weeks_by_version: Record<string, number> }

export async function getLockSchedule(): Promise<LockScheduleView> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_lock_schedule");
  if (error) throw dbError(error, "lock schedule");
  return data as LockScheduleView;
}

export interface RetentionSettings { enabled: boolean; read_notifications_months: number; email_days: number }
export async function getRetention(): Promise<RetentionSettings | null> {
  const sb = await userClient();
  const { data, error } = await sb.from("retention_settings").select("enabled, read_notifications_months, email_days").maybeSingle();
  if (error) throw dbError(error, "retention settings");
  return data as RetentionSettings | null;
}
