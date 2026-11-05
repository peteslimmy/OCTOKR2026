-- 4COREPAL phase 7: governance and administration (docs/38-4COREPAL-DESIGN.md section 18).
-- Editing the escalation policy (executives must always remain reachable), reading usage and the agent's activity, and the retention purge.
-- No function here lets the agent change its own permissions, settings or policies: every change is made by a person holding the matching permission and is audited.

-- ------------------------------------------------------------------ escalation policy
-- Every severity must keep at least one step that reaches the executives, so a case can never be configured to stay below them for ever.
create or replace function ai_check_escalation(p_severity text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from ai_escalation_policies where severity = p_severity and audience = 'EXECUTIVES') then
    raise exception 'VALIDATION_ERROR' using detail = 'every severity must keep a step that reaches the executives';
  end if;
end $$;

create or replace function ai_set_escalation(p_actor uuid, p_severity text, p_step int, p_audience text, p_after_hours int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old ai_escalation_policies;
begin
  perform require_permission(p_actor, 'ai.escalation.manage');
  if p_severity not in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') then raise exception 'VALIDATION_ERROR' using detail = 'unknown severity'; end if;
  if p_step is null or p_step not between 1 and 5 then raise exception 'VALIDATION_ERROR' using detail = 'a step is a number from 1 to 5'; end if;
  if p_audience not in ('BU_LEAD', 'AFFECTED_BU_LEADS', 'EXECUTIVES') then raise exception 'VALIDATION_ERROR' using detail = 'unknown audience'; end if;
  if p_after_hours is null or p_after_hours not between 0 and 720 then raise exception 'VALIDATION_ERROR' using detail = 'hours are from 0 to 720'; end if;
  select * into v_old from ai_escalation_policies where severity = p_severity and step = p_step;
  insert into ai_escalation_policies (severity, step, audience, after_hours, updated_by, updated_at) values (p_severity, p_step, p_audience, p_after_hours, p_actor, app_now())
    on conflict (severity, step) do update set audience = excluded.audience, after_hours = excluded.after_hours, updated_by = p_actor, updated_at = app_now();
  perform ai_check_escalation(p_severity);
  perform write_audit(p_actor, 'AI_ESCALATION_POLICY_CHANGED', 'ai_escalation_policy', p_severity || ':' || p_step, to_jsonb(v_old) - 'updated_by' - 'updated_at', jsonb_build_object('audience', p_audience, 'after_hours', p_after_hours));
end $$;

create or replace function ai_delete_escalation(p_actor uuid, p_severity text, p_step int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old ai_escalation_policies;
begin
  perform require_permission(p_actor, 'ai.escalation.manage');
  select * into v_old from ai_escalation_policies where severity = p_severity and step = p_step;
  if not found then raise exception 'NOT_FOUND'; end if;
  delete from ai_escalation_policies where severity = p_severity and step = p_step;
  if not exists (select 1 from ai_escalation_policies where severity = p_severity) then raise exception 'VALIDATION_ERROR' using detail = 'a severity needs at least one step'; end if;
  perform ai_check_escalation(p_severity);
  perform write_audit(p_actor, 'AI_ESCALATION_POLICY_REMOVED', 'ai_escalation_policy', p_severity || ':' || p_step, to_jsonb(v_old) - 'updated_by' - 'updated_at', null);
end $$;

-- ------------------------------------------------------------------ what it costs and what it did
-- An invoker function: usage rows are visible only to those who audit or configure the module, so row-level security decides who gets numbers.
create or replace function read_ai_usage_summary() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'today', (select jsonb_build_object('calls', count(*), 'costUsd', coalesce(sum(cost_usd), 0), 'inputTokens', coalesce(sum(input_tokens), 0), 'outputTokens', coalesce(sum(output_tokens), 0)) from ai_usage where occurred_at >= date_trunc('day', app_now())),
    'last7', (select jsonb_build_object('calls', count(*), 'costUsd', coalesce(sum(cost_usd), 0), 'errors', count(*) filter (where outcome in ('ERROR', 'TIMEOUT')), 'blocked', count(*) filter (where outcome = 'BLOCKED')) from ai_usage where occurred_at >= app_now() - interval '7 days'),
    'last30', (select jsonb_build_object('calls', count(*), 'costUsd', coalesce(sum(cost_usd), 0)) from ai_usage where occurred_at >= app_now() - interval '30 days'),
    'byPurpose', coalesce((select jsonb_agg(x order by (x->>'calls')::int desc) from (select jsonb_build_object('purpose', purpose, 'calls', count(*), 'costUsd', coalesce(sum(cost_usd), 0), 'avgMs', round(avg(latency_ms))) x from ai_usage where occurred_at >= app_now() - interval '30 days' group by purpose) q), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(distinct model) from ai_usage where occurred_at >= app_now() - interval '30 days'), '[]'::jsonb));
$$;

-- the agent's own activity from the audit log: its answers, requests, cases, decisions, exports and every configuration change. Never the text of a question, answer or remark.
create or replace function read_ai_activity(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not auth_has_permission('ai.audit.view') then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'seq')::bigint desc) from (
      select jsonb_build_object('seq', a.seq, 'at', a.occurred_at, 'action', a.action, 'actor', coalesce(e.first_name || ' ' || e.last_name, case when a.actor_user_id is null then 'The agent' else 'Unknown' end),
             'role', a.actor_role, 'unit', b.name, 'entity', a.entity_type, 'detail', case when a.action in ('AI_SETTING_CHANGED', 'AI_POLICY_CHANGED', 'AI_ESCALATION_POLICY_CHANGED', 'AI_ESCALATION_POLICY_REMOVED') then jsonb_build_object('from', a.old_values, 'to', a.new_values) else null end) x
        from audit_logs a left join users u on u.id = a.actor_user_id left join employees e on e.id = u.employee_id left join business_units b on b.id = a.business_unit_id
       where a.action like 'AI\_%' order by a.seq desc limit greatest(1, least(coalesce(p_limit, 100), 500))) q), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ retention
-- Conversation messages are kept for the number of days in the setting, then deleted with their empty conversations; old job records after 90 days.
-- Case history, remarks, dispositions, usage and the audit log are records of what was done and are never purged here. A message can be deleted only by this purge:
-- the immutability guard lets a delete through only while the purge has switched on its own flag.
create or replace function ai_messages_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.ai_purge', true) = 'on' then return old; end if;
  raise exception 'IMMUTABLE_RECORD' using detail = format('%s on %s is not permitted', tg_op, tg_table_name);
end $$;
drop trigger ai_messages_immutable on ai_messages;
create trigger ai_messages_immutable before update or delete on ai_messages for each row execute function ai_messages_guard();

create or replace function ai_purge() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_days int := coalesce((select (value)::text::int from ai_settings where key = 'retention_days_messages'), 365); v_msgs int; v_convs int; v_jobs int;
begin
  perform set_config('app.ai_purge', 'on', true);
  delete from ai_messages where created_at < app_now() - make_interval(days => v_days); get diagnostics v_msgs = row_count;
  delete from ai_conversations c where c.updated_at < app_now() - make_interval(days => v_days) and not exists (select 1 from ai_messages m where m.conversation_id = c.id); get diagnostics v_convs = row_count;
  delete from ai_jobs where status in ('SUCCEEDED', 'DEAD', 'FAILED') and coalesce(finished_at, started_at, scheduled_for) < app_now() - interval '90 days'; get diagnostics v_jobs = row_count;
  perform set_config('app.ai_purge', 'off', true);
  if v_msgs + v_convs + v_jobs > 0 then perform write_audit(null, 'AI_PURGED', 'ai_retention', null, null, jsonb_build_object('messages', v_msgs, 'conversations', v_convs, 'jobs', v_jobs, 'retention_days', v_days)); end if;
  return jsonb_build_object('messages', v_msgs, 'conversations', v_convs, 'jobs', v_jobs);
end $$;

-- the daily run gains the purge step; everything else in it is as before
create or replace function ai_run_jobs() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tz text; local_now timestamp; v_due time; v_month_due time; j jsonb; v_res jsonb := '{}'::jsonb; v_errs text := ''; v_n jsonb; v_last boolean;
begin
  if not ai_enabled() then return jsonb_build_object('skipped', 'disabled'); end if;
  tz := coalesce(ai_setting('timezone') #>> '{}', 'Africa/Lagos');
  v_due := coalesce(ai_setting('schedule_daily_time') #>> '{}', '07:00')::time;
  v_month_due := coalesce(ai_setting('schedule_monthly_time') #>> '{}', '08:00')::time;
  local_now := app_now() at time zone tz;
  if local_now::time < v_due then return jsonb_build_object('waiting', 'before the daily time'); end if;

  j := ai_job_begin('daily', 'daily:' || local_now::date, app_now());
  if (j->>'run')::boolean then
    begin v_n := to_jsonb(ai_scan_findings()); v_res := v_res || jsonb_build_object('findings', v_n); exception when others then v_errs := v_errs || 'findings: ' || sqlerrm || '; '; end;
    begin v_n := to_jsonb(ai_cases_from_findings()); v_res := v_res || jsonb_build_object('casesFromFindings', v_n); exception when others then v_errs := v_errs || 'cases(findings): ' || sqlerrm || '; '; end;
    begin v_n := ai_remark_tick(); v_res := v_res || jsonb_build_object('remarks', v_n); exception when others then v_errs := v_errs || 'remarks: ' || sqlerrm || '; '; end;
    begin v_n := to_jsonb(ai_cases_from_remarks()); v_res := v_res || jsonb_build_object('casesFromRemarks', v_n); exception when others then v_errs := v_errs || 'cases(remarks): ' || sqlerrm || '; '; end;
    begin v_n := to_jsonb(ai_draft_plans()); v_res := v_res || jsonb_build_object('plansDrafted', v_n); exception when others then v_errs := v_errs || 'plans: ' || sqlerrm || '; '; end;
    begin v_n := ai_engagement_tick(); v_res := v_res || jsonb_build_object('engagement', v_n); exception when others then v_errs := v_errs || 'engagement: ' || sqlerrm || '; '; end;
    begin v_n := to_jsonb(ai_review_plans()); v_res := v_res || jsonb_build_object('plansReviewed', v_n); exception when others then v_errs := v_errs || 'review: ' || sqlerrm || '; '; end;
    begin v_n := ai_purge(); v_res := v_res || jsonb_build_object('purged', v_n); exception when others then v_errs := v_errs || 'purge: ' || sqlerrm || '; '; end;
    perform ai_job_finish((j->>'id')::uuid, v_errs = '', nullif(v_errs, ''), v_res);
    v_res := v_res || jsonb_build_object('ran', 'daily');
    if v_errs <> '' then v_res := v_res || jsonb_build_object('failed', v_errs); end if;
  else
    v_res := jsonb_build_object('skipped', j->>'status');
  end if;

  v_last := (local_now::date + 1) = (date_trunc('month', local_now::date + 1))::date;
  if v_last and local_now::time >= v_month_due then
    j := ai_job_begin('monthly', 'monthly:' || to_char(local_now, 'YYYY-MM'), app_now());
    if (j->>'run')::boolean then
      begin
        v_n := ai_closure_tick(date_trunc('month', local_now::date)::date);
        perform ai_job_finish((j->>'id')::uuid, true, null, v_n);
        v_res := v_res || jsonb_build_object('monthly', v_n);
      exception when others then
        perform ai_job_finish((j->>'id')::uuid, false, sqlerrm);
        v_res := v_res || jsonb_build_object('monthlyFailed', sqlerrm);
      end;
    end if;
  end if;
  return v_res;
end $$;

select lock_down_function_grants();
