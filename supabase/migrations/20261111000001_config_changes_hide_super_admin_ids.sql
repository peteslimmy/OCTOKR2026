-- ADR-118: a Super Admin account is invisible to everyone else. The configuration-change queue already showed a hidden person's name as
-- "Unknown"/blank, but still returned their user id in requested_by and decided_by, and inside the saved snapshot of the current setting
-- (for example the created_by of the penalty rate in force). The ids are now withheld from viewers who may not see that person.

-- replaces every hidden user's id inside a JSON value with null-looking text, for the signed-in viewer
create or replace function redact_hidden_ids(p_json jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_text text; v_id uuid;
begin
  if p_json is null then return null; end if;
  v_text := p_json::text;
  foreach v_id in array coalesce(hidden_user_ids(), '{}'::uuid[]) loop
    v_text := replace(v_text, v_id::text, '00000000-0000-0000-0000-000000000000');
  end loop;
  return v_text::jsonb;
end $$;

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('read_config_changes'::regproc);
  v_new := replace(v_def, 'c.requested_by,', 'case when c.requested_by = any(hidden_user_ids()) then null else c.requested_by end as requested_by,');
  v_new := replace(v_new, 'c.decided_by,', 'case when c.decided_by = any(hidden_user_ids()) then null else c.decided_by end as decided_by,');
  v_new := replace(v_new, 'c.proposed,', 'redact_hidden_ids(c.proposed) as proposed,');
  v_new := replace(v_new, 'c.current_value,', 'redact_hidden_ids(c.current_value) as current_value,');
  if v_new = v_def then raise exception 'read_config_changes: nothing to change'; end if;
  execute v_new;
end $$;
select lock_down_function_grants();
-- the read functions run as the caller and call this one, so the caller may run it (it only removes hidden ids)
grant execute on function redact_hidden_ids(jsonb) to authenticated;
