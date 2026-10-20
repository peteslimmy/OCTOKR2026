-- Reminders and the email channel (owner decision 6, 14 October 2026; ADR-061; docs/17-NOTIFICATIONS.md).
-- The in-app notification stays authoritative. Email is a secondary, asynchronous channel: a failure to send never touches the business
-- operation that raised the event, and a retry never repeats it. Which provider carries the mail is an open decision (ADR-054 #8), so
-- the application hands rows to a configurable transport; with none configured, mail simply waits and then expires.

insert into permissions (code, description) values ('reminders.configure', 'Configure report reminders and email delivery settings');
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values ('ADMIN','reminders.configure'),('SUPER_ADMIN','reminders.configure')) as g(role_code, perm)
join roles r on r.code = g.role_code join permissions p on p.code = g.perm;

-- ---------------------------------------------------------------- how a week is written, in one place (ADR-055; mirrors src/lib/domain/week-label.ts)
create or replace function week_label_text(p_number int, p_start timestamptz) returns text
language sql immutable set search_path = public, pg_temp as $$
  with d as (select (p_start at time zone 'Africa/Lagos')::date as s, ((p_start at time zone 'Africa/Lagos')::date + 6) as e)
  select 'Week ' || p_number || ', ' || case
    when extract(year from s) <> extract(year from e) then to_char(s, 'FMDD Mon YYYY') || ' – ' || to_char(e, 'FMDD Mon YYYY')
    when extract(month from s) <> extract(month from e) then to_char(s, 'FMDD Mon') || ' – ' || to_char(e, 'FMDD Mon YYYY')
    else extract(day from s)::int || '–' || to_char(e, 'FMDD Mon YYYY') end
  from d;
$$;

-- ---------------------------------------------------------------- settings (one row)
create table notification_settings (
  id                    boolean primary key default true check (id),
  reminders_enabled     boolean not null default true,
  reminder_hours        int[] not null default '{24,6}',     -- hours before the content lock at which a reminder may go out
  max_reminders_per_week int not null default 2,             -- frequency limit per person per week
  email_enabled         boolean not null default true,
  updated_by            uuid references users(id),
  updated_at            timestamptz not null default app_now(),
  check (cardinality(reminder_hours) between 1 and 4),
  check (max_reminders_per_week between 1 and 5)
);
insert into notification_settings default values;

create or replace function update_notification_settings(p_actor uuid, p_reminders boolean, p_hours int[], p_max int, p_email boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old notification_settings; h int;
begin
  perform require_permission(p_actor, 'reminders.configure');
  if p_hours is null or cardinality(p_hours) < 1 or cardinality(p_hours) > 4 or (select count(distinct x) from unnest(p_hours) x) <> cardinality(p_hours) then
    raise exception 'VALIDATION_ERROR' using detail = 'choose between one and four different reminder times';
  end if;
  foreach h in array p_hours loop
    if h is null or h < 1 or h > 72 then raise exception 'VALIDATION_ERROR' using detail = 'a reminder goes out between 1 and 72 hours before the lock'; end if;
  end loop;
  if p_max is null or p_max < 1 or p_max > 5 then raise exception 'VALIDATION_ERROR' using detail = 'between 1 and 5 reminders per person per week'; end if;
  select * into v_old from notification_settings where id;
  update notification_settings set reminders_enabled = coalesce(p_reminders, true), reminder_hours = (select array_agg(x order by x desc) from unnest(p_hours) x),
    max_reminders_per_week = p_max, email_enabled = coalesce(p_email, true), updated_by = p_actor, updated_at = app_now() where id;
  perform write_audit(p_actor, 'NOTIFICATION_SETTINGS_UPDATED', 'notification_settings', 'singleton',
    jsonb_build_object('reminders_enabled', v_old.reminders_enabled, 'reminder_hours', v_old.reminder_hours, 'max_reminders_per_week', v_old.max_reminders_per_week, 'email_enabled', v_old.email_enabled),
    (select jsonb_build_object('reminders_enabled', reminders_enabled, 'reminder_hours', reminder_hours, 'max_reminders_per_week', max_reminders_per_week, 'email_enabled', email_enabled) from notification_settings where id));
  return (select to_jsonb(s) from notification_settings s where id);
end $$;

-- ---------------------------------------------------------------- who gets email, for which events
create table email_event_types (
  event_type  text primary key,
  mandatory   boolean not null default false,     -- security events are always emailed, whatever the person prefers
  description text not null
);
insert into email_event_types (event_type, mandatory, description) values
  ('REPORT_DUE_REMINDER',            false, 'Your weekly report is due soon'),
  ('ORGANIZATION_HOLIDAY',           false, 'An organisation holiday was declared'),
  ('ORGANIZATION_HOLIDAY_AMENDED',   false, 'A past week was changed to or from a holiday'),
  ('HOLIDAY_AMENDMENT_REQUESTED',    false, 'A holiday amendment needs your decision'),
  ('HOLIDAY_AMENDMENT_APPROVED',     false, 'Your holiday amendment request was decided'),
  ('HOLIDAY_AMENDMENT_REJECTED',     false, 'Your holiday amendment request was decided'),
  ('LEDGER_REVERSAL_REQUESTED',      false, 'A ledger reversal needs your decision'),
  ('LEDGER_REVERSAL_APPROVED',       false, 'A ledger reversal is ready to post'),
  ('LEDGER_REVERSAL_DECIDED',        false, 'Your ledger reversal request was decided'),
  ('LEDGER_REVERSAL_EXECUTED',       false, 'A ledger reversal was posted'),
  ('DISBURSEMENT_REQUESTED',         false, 'A disbursement request needs your decision'),
  ('DISBURSEMENT_APPROVED',          false, 'A disbursement request was approved'),
  ('DISBURSEMENT_REJECTED',          false, 'A disbursement request was rejected'),
  ('LATE_REPORT_AUTHORISED',         false, 'A late report was authorised'),
  ('LEDGER_REVERSAL_EMERGENCY',      true,  'An emergency ledger reversal was posted'),
  ('PASSWORD_CHANGED',               true,  'Your password was changed'),
  ('MFA_RESET',                      true,  'Your authenticator was reset'),
  ('MFA_RECOVERED',                  true,  'A recovery code was used on your account'),
  ('BREAK_GLASS',                    true,  'A break-glass reset was performed');

create table notification_preferences (
  user_id       uuid primary key references users(id) on delete cascade,
  email_enabled boolean not null default true,
  updated_at    timestamptz not null default app_now()
);
alter table notification_preferences enable row level security;
grant select on notification_preferences to authenticated;
create policy read_own on notification_preferences for select to authenticated using (user_id = auth.uid());

create or replace function set_email_preference(p_actor uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_enabled is null then raise exception 'VALIDATION_ERROR'; end if;
  insert into notification_preferences (user_id, email_enabled) values (p_actor, p_enabled)
    on conflict (user_id) do update set email_enabled = excluded.email_enabled, updated_at = app_now();
  perform write_audit(p_actor, 'NOTIFICATION_PREFERENCE_CHANGED', 'user', p_actor::text, null, jsonb_build_object('email_enabled', p_enabled));
end $$;

-- ---------------------------------------------------------------- the outbox
create table email_outbox (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references notifications(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  to_email        text not null,
  subject         text not null,
  body            text not null,
  mandatory       boolean not null default false,
  status          text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED','SKIPPED')),
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  leased_until    timestamptz,
  expires_at      timestamptz not null default (now() + interval '48 hours'),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index email_outbox_due_idx on email_outbox (next_attempt_at) where status in ('PENDING','SENDING');
alter table email_outbox enable row level security;      -- no grant, no policy: only the service role and the read function below touch it

-- A notification that deserves email gets a mail row, atomically with the notification, but a failure here can never fail the notification.
create or replace function enqueue_email_for_notification() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t email_event_types; v_s notification_settings; v_u users; v_pref boolean;
begin
  select * into v_t from email_event_types where event_type = new.event_type;
  if not found then return new; end if;
  select * into v_s from notification_settings where id;
  if not v_s.email_enabled then return new; end if;
  select * into v_u from users where id = new.user_id and status = 'ACTIVE';
  if not found or v_u.email is null then return new; end if;
  select email_enabled into v_pref from notification_preferences where user_id = new.user_id;
  if not v_t.mandatory and coalesce(v_pref, true) = false then return new; end if;
  insert into email_outbox (notification_id, user_id, to_email, subject, body, mandatory)
    values (new.id, new.user_id, v_u.email::text, left(new.title, 200), left(new.message, 2000), v_t.mandatory) on conflict do nothing;
  return new;
exception when others then
  raise warning 'enqueue_email_for_notification failed: %', sqlerrm;
  return new;
end $$;
create trigger notifications_enqueue_email after insert on notifications for each row execute function enqueue_email_for_notification();

-- Hands a batch to a sender. Rows that expired are closed (an old reminder is worse than none); rows a crashed sender left leased are retaken.
create or replace function claim_email_batch(p_limit int default 25) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  update email_outbox set status = 'SKIPPED', last_error = 'expired before it could be sent', leased_until = null
    where status in ('PENDING','SENDING') and expires_at <= now();
  with due as (
    select id from email_outbox
     where (status = 'PENDING' and next_attempt_at <= now()) or (status = 'SENDING' and leased_until < now())
     order by created_at limit greatest(1, least(coalesce(p_limit, 25), 100)) for update skip locked
  ), upd as (
    update email_outbox o set status = 'SENDING', attempts = o.attempts + 1, leased_until = now() + interval '5 minutes'
      from due where o.id = due.id returning o.id, o.to_email, o.subject, o.body, o.attempts
  )
  select coalesce(jsonb_agg(to_jsonb(upd)), '[]'::jsonb) into v from upd;
  return v;
end $$;

-- Records the outcome. A failure backs off (2, 4, 8, 16 minutes) and gives up after five attempts; it never touches the business event.
create or replace function mark_email_result(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o email_outbox;
begin
  select * into o from email_outbox where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'SENDING' then return; end if;
  if p_ok then
    update email_outbox set status = 'SENT', sent_at = now(), leased_until = null, last_error = null where id = p_id;
  elsif o.attempts >= 5 then
    update email_outbox set status = 'FAILED', leased_until = null, last_error = left(coalesce(p_error, 'unknown error'), 500) where id = p_id;
  else
    update email_outbox set status = 'PENDING', leased_until = null, last_error = left(coalesce(p_error, 'unknown error'), 500),
      next_attempt_at = now() + make_interval(mins => power(2, o.attempts)::int) where id = p_id;
  end if;
end $$;

-- A mail the transport cannot ever send (no provider configured) is parked, not retried forever.
create or replace function skip_email(p_id uuid, p_reason text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update email_outbox set status = 'SKIPPED', leased_until = null, last_error = left(p_reason, 500) where id = p_id and status in ('PENDING','SENDING');
$$;

create or replace function read_email_summary() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not auth_has_permission('reminders.configure') then raise exception 'PERMISSION_DENIED'; end if;
  return jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*)::int n from email_outbox group by status) s), '{}'::jsonb),
    'recent_problems', coalesce((select jsonb_agg(jsonb_build_object('at', created_at, 'status', status, 'attempts', attempts, 'error', last_error, 'subject', subject) order by created_at desc)
                                 from (select * from email_outbox where status in ('FAILED','SKIPPED') or (status = 'PENDING' and attempts > 0) order by created_at desc limit 10) p), '[]'::jsonb),
    'settings', (select to_jsonb(s) - 'id' from notification_settings s where id));
end $$;
grant execute on function read_email_summary() to authenticated;

-- ---------------------------------------------------------------- report reminders
-- For every expected Business Unit that has not submitted, before the content lock. One reminder per person per slot (a slot is a
-- configured number of hours before the lock), at most max_reminders_per_week per person per week, never for a holiday week, never
-- after the lock, and if the scheduler was down only the most recent slot is sent (not a burst of missed ones).
create or replace function send_report_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare s notification_settings; w record; b record; u record; v_slot int; v_hours numeric; v_sent int := 0; v_n int;
begin
  select * into s from notification_settings where id;
  if not s.reminders_enabled then return 0; end if;
  for w in select * from reporting_weeks where reporting_state = 'NORMAL' and status <> 'FINAL_LOCKED' and app_now() < content_lock_at loop
    -- the most recent slot that has been reached: the smallest configured number of hours that is still >= the time left
    select min(h) into v_slot from unnest(s.reminder_hours) h where app_now() >= w.content_lock_at - make_interval(hours => h);
    if v_slot is null then continue; end if;
    v_hours := ceil(extract(epoch from (w.content_lock_at - app_now())) / 3600);
    for b in select bu.id, bu.name from business_units bu
              where bu.status = 'ACTIVE' and bu.reports_weekly and bu.created_at < w.week_end_at
                and not exists (select 1 from weekly_reports r where r.business_unit_id = bu.id and r.reporting_week_id = w.id and r.submission_status = 'SUBMITTED') loop
      for u in select distinct us.id from users us join employees e on e.id = us.employee_id join user_roles ur on ur.user_id = us.id join roles ro on ro.id = ur.role_id
                where us.status = 'ACTIVE' and e.business_unit_id = b.id and ro.code = 'BU_LEAD' loop
        select count(*) into v_n from notifications where user_id = u.id and event_type = 'REPORT_DUE_REMINDER' and entity_id = w.id::text;
        if v_n >= s.max_reminders_per_week then continue; end if;
        insert into notifications (user_id, event_type, entity_type, entity_id, title, message, dedupe_key)
          values (u.id, 'REPORT_DUE_REMINDER', 'reporting_week', w.id::text,
                  'Weekly report due in about ' || v_hours || (case when v_hours = 1 then ' hour' else ' hours' end),
                  b.name || ' has not submitted its report for ' || week_label_text(w.week_number, w.week_start_at) || '. Goals and tasks lock on Tuesday at 18:00 (Lagos time). Add at least one SMART goal and submit.',
                  'remind:' || w.id || ':' || b.id || ':' || v_slot)
          on conflict (user_id, dedupe_key) do nothing;
        if found then v_sent := v_sent + 1; end if;
      end loop;
    end loop;
  end loop;
  return v_sent;
end $$;

-- the scheduler runs the reminders too
create or replace function run_scheduled_jobs() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w record; v_result jsonb := '{}'::jsonb; v_final int := 0; v_content int := 0; v_roll jsonb; v_err text; v_remind int := 0;
begin
  -- 1. quarter roll (lock/activate); activation also materialises the calendar weeks
  begin v_roll := roll_quarters(); v_result := v_result || jsonb_build_object('quarters', v_roll);
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform write_audit(null, 'JOB_FAILED', 'job', 'roll_quarters', null, jsonb_build_object('error', v_err), null, null, 'FAILURE');
  end;
  for w in select id from quarters where status = 'ACTIVE' loop perform ensure_quarter_weeks(w.id); end loop;
  -- 2. content-lock processing (status mirror + audit); enforcement never depends on this
  for w in select * from reporting_weeks where status <> 'FINAL_LOCKED' and app_now() >= content_lock_at loop
    update weekly_reports set status = 'CONTENT_LOCKED', content_locked_at = coalesce(content_locked_at, w.content_lock_at), updated_at = app_now()
     where reporting_week_id = w.id and status = 'OPEN';
    if found then
      perform write_audit(null, 'REPORTING_WEEK_CONTENT_LOCKED', 'reporting_week', w.id::text, null, null);
      v_content := v_content + 1;
    end if;
    update reporting_weeks set status = 'OPEN' where id = w.id and status = 'SCHEDULED';
  end loop;
  -- 3. final lock processing, one transaction per week (savepoint) so one failure does not block others
  for w in select id from reporting_weeks where status <> 'FINAL_LOCKED' and app_now() >= final_lock_at order by final_lock_at loop
    begin
      perform finalize_reporting_week(w.id); v_final := v_final + 1;
    exception when others then
      get stacked diagnostics v_err = message_text;
      perform write_audit(null, 'JOB_FAILED', 'reporting_week', w.id::text, null, jsonb_build_object('error', v_err), null, null, 'FAILURE');
    end;
  end loop;
  -- 4. reminders for reports that are still missing (after the locks above, so a week that just closed is never reminded about)
  begin v_remind := send_report_reminders();
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform write_audit(null, 'JOB_FAILED', 'job', 'send_report_reminders', null, jsonb_build_object('error', v_err), null, null, 'FAILURE');
  end;
  return v_result || jsonb_build_object('content_locked_weeks', v_content, 'finalized_weeks', v_final, 'reminders_sent', v_remind);
end $$;

select lock_down_function_grants();
grant execute on function read_email_summary() to authenticated;
