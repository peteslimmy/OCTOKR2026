-- 1. A comment on the weekly report: the unit's own narrative for the week, written with light formatting (stored as plain text in a small
--    markdown-like subset, never as HTML, so nothing in it can run).
-- 2. Bulk goals: a Business Unit Lead (or a Super Admin filing for the unit) adds many goals with their tasks in one step. All or nothing:
--    one bad goal and nothing is added.

alter table weekly_reports add column comment text check (comment is null or char_length(comment) <= 4000);

create or replace function set_report_comment(p_actor uuid, p_report_id uuid, p_comment text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports; v_w reporting_weeks; v_text text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform require_permission(p_actor, 'weekly_report.edit');
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not actor_may_file_for(p_actor, v_r.business_unit_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  select * into v_w from reporting_weeks where id = v_r.reporting_week_id;
  if v_w.reporting_state = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED'; end if;
  if report_phase_of(v_r) = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;     -- the comment may be written until the week is scored
  if v_text is not null and char_length(v_text) > 4000 then raise exception 'VALIDATION_ERROR' using detail = 'the comment is limited to 4000 characters'; end if;
  update weekly_reports set comment = v_text, updated_at = app_now() where id = p_report_id;
  perform write_audit(p_actor, 'REPORT_COMMENT_SAVED', 'weekly_report', p_report_id::text, null, jsonb_build_object('length', char_length(coalesce(v_text, ''))), null, v_r.business_unit_id);
end $$;

-- p_goals: [{ goal_type, sub_kr_id, title, description, tasks: [{description}], evaluation }]
create or replace function bulk_create_goals(p_actor uuid, p_report_id uuid, p_goals jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g jsonb; n int := 0;
begin
  if p_goals is null or jsonb_typeof(p_goals) <> 'array' or jsonb_array_length(p_goals) = 0 then raise exception 'VALIDATION_ERROR' using detail = 'the file holds no goals'; end if;
  if jsonb_array_length(p_goals) > 100 then raise exception 'VALIDATION_ERROR' using detail = 'add at most 100 goals at a time'; end if;
  for g in select * from jsonb_array_elements(p_goals) loop
    perform create_goal(p_actor, p_report_id, g->>'goal_type', nullif(g->>'sub_kr_id', '')::uuid, g->>'title', nullif(g->>'description', ''), g->'tasks', g->'evaluation', null);
    n := n + 1;
  end loop;
  perform write_audit(p_actor, 'GOALS_BULK_ADDED', 'weekly_report', p_report_id::text, null, jsonb_build_object('goals', n), null, (select business_unit_id from weekly_reports where id = p_report_id));
  return jsonb_build_object('created', n);
end $$;

do $$
declare v_def text; v_old text := '''skipped_session_summary_comment'', r.skipped_session_summary_comment,';
begin
  v_def := pg_get_functiondef('read_report_view_base(uuid)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'read_report_view_base no longer contains the expected line'; end if;
  execute replace(v_def, v_old, v_old || ' ''comment'', r.comment,');
end $$;

select lock_down_function_grants();
