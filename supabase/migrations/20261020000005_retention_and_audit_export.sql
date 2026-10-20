-- Retention of transient data and audit-log export (ADR-072, docs/30 S-1, P-1).
-- Only data nobody needs as evidence is ever purged: notifications that were read, and email queue rows that are finished. Audit, ledger, scores,
-- reports, violations, import records and everything else append-only are NEVER touched (and most of them cannot be: the database refuses).
-- The periods are a setting, changed through an approved configuration change (ADR-068).

insert into permissions (code, description) values ('retention.configure', 'Ask for a change to how long read notifications and finished emails are kept')
on conflict (code) do nothing;
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values ('ADMIN','retention.configure'), ('SUPER_ADMIN','retention.configure')) v(role_code, perm)
join roles r on r.code = v.role_code join permissions p on p.code = v.perm on conflict do nothing;

create table retention_settings (
  id                         boolean primary key default true check (id),
  enabled                    boolean not null default true,
  read_notifications_months  int not null default 12 check (read_notifications_months between 3 and 120),
  email_days                 int not null default 90 check (email_days between 7 and 730),
  updated_by                 uuid references users(id),
  updated_at                 timestamptz not null default app_now()
);
insert into retention_settings default values;
alter table retention_settings enable row level security;
grant select on retention_settings to authenticated;
create policy read_scoped on retention_settings for select to authenticated using ((select auth_has_any(array['retention.configure','config.approve','audit.read'])));

-- ------------------------------------------------------------------ the change, and the table-driven way to add topics
alter table config_change_topics add column applier text, add column current_fn text;
comment on column config_change_topics.applier is 'name of a function(config_change_requests) that applies an approved request; used for topics added after the first five';
comment on column config_change_topics.current_fn is 'name of a function(text target) returning the value in force now, shown to the approver';

create or replace function apply_retention_change(r config_change_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := r.proposed; v_old retention_settings; v_months int; v_days int; v_enabled boolean;
begin
  perform require_permission(r.requested_by, 'retention.configure');
  begin
    v_months := (p->>'readNotificationsMonths')::int; v_days := (p->>'emailDays')::int; v_enabled := (p->>'enabled')::boolean;
  exception when others then raise exception 'VALIDATION_ERROR' using detail = 'give the months, the days and whether purging is on';
  end;
  if v_months is null or v_days is null or v_enabled is null then raise exception 'VALIDATION_ERROR' using detail = 'give the months, the days and whether purging is on'; end if;
  if v_months not between 3 and 120 then raise exception 'VALIDATION_ERROR' using detail = 'read notifications are kept for 3 to 120 months'; end if;
  if v_days not between 7 and 730 then raise exception 'VALIDATION_ERROR' using detail = 'finished emails are kept for 7 to 730 days'; end if;
  select * into v_old from retention_settings;
  if v_old.read_notifications_months = v_months and v_old.email_days = v_days and v_old.enabled = v_enabled then raise exception 'VALIDATION_ERROR' using detail = 'these are the settings already in force'; end if;
  update retention_settings set enabled = v_enabled, read_notifications_months = v_months, email_days = v_days, updated_by = r.requested_by, updated_at = app_now();
  perform write_audit(r.requested_by, 'RETENTION_CHANGED', 'retention_settings', 'singleton',
    jsonb_build_object('enabled', v_old.enabled, 'read_notifications_months', v_old.read_notifications_months, 'email_days', v_old.email_days),
    jsonb_build_object('enabled', v_enabled, 'read_notifications_months', v_months, 'email_days', v_days), r.reason);
end $$;

create or replace function retention_current(p_target text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('enabled', enabled, 'readNotificationsMonths', read_notifications_months, 'emailDays', email_days) from retention_settings;
$$;

insert into config_change_topics (code, description, request_permission, approve_permission, protected, applier, current_fn)
values ('RETENTION', 'Change how long read notifications and finished emails are kept', 'retention.configure', 'config.approve', false, 'apply_retention_change', 'retention_current');

create or replace function config_current_value(p_topic text, p_target text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_fn text; v_out jsonb;
begin
  v_out := case p_topic
    when 'VIOLATION_TYPE'    then (select to_jsonb(v) from violation_types v where p_target is not null and (v.id::text = p_target or v.code = upper(p_target)))
    when 'PENALTY_RATE'      then (select to_jsonb(c) from integrity_penalty_configurations c where c.effective_to is null order by c.created_at desc limit 1)
    when 'REMINDER_SETTINGS' then (select to_jsonb(s) from notification_settings s where s.id)
    when 'BU_REPORTING'      then (select to_jsonb(b) from business_units b where p_target is not null and b.id = p_target::uuid)
    when 'ROLE_CHANGE'       then (select jsonb_build_object('code', r.code, 'name', r.name, 'description', r.description, 'permissions', role_permission_codes(r.id),
                                     'requiresMfa', exists (select 1 from mfa_required_roles m where m.role_id = r.id), 'holders', (select count(*) from user_roles ur where ur.role_id = r.id))
                                   from roles r where p_target is not null and r.id::text = p_target)
    when 'LOCK_SCHEDULE'     then (select jsonb_build_object('contentLockDay', s.content_lock_dow, 'contentLockTime', to_char(s.content_lock_time, 'HH24:MI'), 'contentLockWeekOffset', s.content_lock_week_offset,
                                     'finalLockDay', s.final_lock_dow, 'finalLockTime', to_char(s.final_lock_time, 'HH24:MI'), 'finalLockWeekOffset', s.final_lock_week_offset, 'version', s.version)
                                   from reporting_schedule_versions s order by s.version desc limit 1)
    else null end;
  if v_out is null then
    select current_fn into v_fn from config_change_topics where code = p_topic;
    if v_fn is not null then execute format('select %I($1)', v_fn) into v_out using p_target; end if;
  end if;
  return v_out;
end $$;

create or replace function apply_config_change(r config_change_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := r.proposed; v_applier text;
begin
  case r.topic
    when 'VIOLATION_TYPE' then
      if p->>'action' = 'CREATE' then
        perform create_violation_type(r.requested_by, p->>'code', p->>'name', p->>'criticality', (p->>'defaultFine')::numeric);
      elsif p->>'action' = 'UPDATE' and r.target is not null then
        perform update_violation_type(r.requested_by, r.target::uuid, p->>'name', p->>'criticality', (p->>'defaultFine')::numeric, (p->>'active')::boolean);
      else raise exception 'VALIDATION_ERROR' using detail = 'action must be CREATE or UPDATE (with a target)';
      end if;
    when 'PENALTY_RATE' then
      perform set_integrity_penalty_rate(r.requested_by, (p->>'rate')::numeric);
    when 'REMINDER_SETTINGS' then
      perform update_notification_settings(r.requested_by, (p->>'remindersEnabled')::boolean,
        (select array_agg(x::int) from jsonb_array_elements_text(p->'reminderHours') x), (p->>'maxRemindersPerWeek')::int, (p->>'emailEnabled')::boolean);
    when 'BU_REPORTING' then
      if r.target is null then raise exception 'VALIDATION_ERROR' using detail = 'choose the Business Unit'; end if;
      perform update_business_unit(r.requested_by, r.target::uuid, p->>'name', p->>'status', coalesce((p->>'reportsWeekly')::boolean, true));
    when 'ROLE_CHANGE' then
      perform apply_role_change(r);
    when 'LOCK_SCHEDULE' then
      perform apply_lock_schedule(r);
    else
      select applier into v_applier from config_change_topics where code = r.topic;
      if v_applier is null then raise exception 'VALIDATION_ERROR' using detail = 'unknown configuration topic ' || r.topic; end if;
      execute format('select %I($1)', v_applier) using r;
  end case;
exception when invalid_text_representation or numeric_value_out_of_range or null_value_not_allowed or invalid_parameter_value then
  raise exception 'VALIDATION_ERROR' using detail = 'the proposed values are not valid for this setting';
end $$;

-- ------------------------------------------------------------------ the purge
create or replace function purge_transient_data() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s retention_settings; v_notif int := 0; v_mail int := 0; v_rate int := 0;
begin
  select * into s from retention_settings;
  delete from rate_limit_hits where at < clock_timestamp() - interval '1 day';
  get diagnostics v_rate = row_count;
  if not s.enabled then return jsonb_build_object('enabled', false, 'rate_limit_hits', v_rate); end if;
  -- finished mail first (a delivered or abandoned message is of no use after a while), then read notifications (their remaining queue rows go with them)
  delete from email_outbox where created_at < app_now() - make_interval(days => s.email_days) and (status in ('SENT','FAILED','SKIPPED') or expires_at < app_now());
  get diagnostics v_mail = row_count;
  delete from notifications where read_at is not null and created_at < app_now() - make_interval(months => s.read_notifications_months);
  get diagnostics v_notif = row_count;
  if v_notif + v_mail > 0 then
    perform write_audit(null, 'TRANSIENT_DATA_PURGED', 'retention_settings', 'singleton', null,
      jsonb_build_object('read_notifications', v_notif, 'email_queue_rows', v_mail, 'read_notifications_months', s.read_notifications_months, 'email_days', s.email_days));
  end if;
  return jsonb_build_object('enabled', true, 'read_notifications', v_notif, 'email_queue_rows', v_mail, 'rate_limit_hits', v_rate);
end $$;

-- once a day, as part of the scheduler; a failure is recorded and never stops the other steps
create or replace function maybe_purge_transient_data() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_last timestamptz;
begin
  select last_run_at into v_last from job_heartbeats where job = 'purge';
  if v_last is not null and v_last > clock_timestamp() - interval '23 hours' then return null; end if;
  perform record_job_heartbeat('purge');
  return purge_transient_data();
end $$;

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'run_scheduled_jobs';
  v_new := replace(v_def, 'perform record_job_heartbeat(); return v_result',
    'begin perform maybe_purge_transient_data(); exception when others then get stacked diagnostics v_err = message_text; '
    || 'perform write_audit(null, ''JOB_FAILED'', ''job'', ''purge_transient_data'', null, jsonb_build_object(''error'', v_err), null, null, ''FAILURE''); end; '
    || 'perform record_job_heartbeat(); return v_result');
  if v_new = v_def then raise exception 'expected text not found in run_scheduled_jobs'; end if;
  execute v_new;
end $$;

-- ------------------------------------------------------------------ audit-log export is itself audited
create or replace function record_audit_export(p_actor uuid, p_filter jsonb, p_rows int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'audit.read');
  perform write_audit(p_actor, 'AUDIT_EXPORTED', 'audit_log', 'export', null, jsonb_build_object('filter', coalesce(p_filter, '{}'::jsonb), 'rows', p_rows));
end $$;

select lock_down_function_grants();
