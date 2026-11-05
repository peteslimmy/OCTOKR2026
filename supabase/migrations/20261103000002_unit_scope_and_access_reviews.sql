-- 1. Unit scope: a person can be limited to chosen Business Units for the hands-on work that is about a particular unit or person (raising and settling
--    violations, setting and correcting a person's attendance). A person with no scope rows is unrestricted, exactly as before. Organisation-wide work
--    (holding a session, finalising a roster, skipping an OKR session) is not unit-specific and is not limited by scope.
-- 2. Access reviews: a periodic check of who has what, with a decision for every person and a signed attestation. One can be opened by hand or opens by itself
--    on a schedule. Nobody decides their own access; the signer's own line is recorded as not reviewed.

create table user_unit_scopes (
  user_id          uuid not null references users(id) on delete cascade,
  business_unit_id uuid not null references business_units(id),
  granted_by       uuid not null references users(id),
  created_at       timestamptz not null default app_now(),
  primary key (user_id, business_unit_id)
);
alter table user_unit_scopes enable row level security;
grant select on user_unit_scopes to authenticated;
create policy read_own_or_manage on user_unit_scopes for select to authenticated using (user_id = (select auth.uid()) or (select auth_has_permission('roles.manage')));

create or replace function assert_unit_scope(p_actor uuid, p_bu uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_bu is null then return; end if;
  if exists (select 1 from user_unit_scopes where user_id = p_actor) and not exists (select 1 from user_unit_scopes where user_id = p_actor and business_unit_id = p_bu) then
    raise exception 'UNIT_SCOPE_DENIED' using detail = 'this person''s access is limited to specific units, and this one is not among them';
  end if;
end $$;

-- p_units empty or null removes the limit
create or replace function set_user_unit_scope(p_actor uuid, p_user uuid, p_units uuid[], p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_old uuid[]; u uuid;
begin
  perform require_permission(p_actor, 'roles.manage');
  if not exists (select 1 from users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  select coalesce(array_agg(business_unit_id), '{}') into v_old from user_unit_scopes where user_id = p_user;
  if p_units is not null then
    foreach u in array p_units loop
      if not exists (select 1 from business_units where id = u and status = 'ACTIVE') then raise exception 'VALIDATION_ERROR' using detail = 'every unit in a scope must be an active unit'; end if;
    end loop;
  end if;
  delete from user_unit_scopes where user_id = p_user;
  if p_units is not null and cardinality(p_units) > 0 then
    insert into user_unit_scopes (user_id, business_unit_id, granted_by) select p_user, x, p_actor from unnest(p_units) x on conflict do nothing;
  end if;
  perform write_audit(p_actor, 'USER_UNIT_SCOPE_CHANGED', 'user', p_user::text, jsonb_build_object('units', v_old), jsonb_build_object('units', coalesce(p_units, '{}')), v_reason);
end $$;

-- the scope applies to the work that is about a unit or a person in it
do $$
declare v_def text; r record;
begin
  for r in select * from (values
    ('create_violation(uuid,uuid,uuid,uuid,numeric,text,text,text)', 'select * into emp from employees where id = p_employee;', 'perform assert_unit_scope(p_actor, (select business_unit_id from employees where id = p_employee));'),
    ('update_violation(uuid,uuid,numeric,text,text)', 'select * into v from violations where id = p_id for update;', 'perform assert_unit_scope(p_actor, (select business_unit_id from violations where id = p_id));'),
    ('record_violation_payment(uuid,uuid,text,text,date,text)', 'select * into v from violations where id = p_violation for update;', 'perform assert_unit_scope(p_actor, (select business_unit_id from violations where id = p_violation));'),
    ('void_violation(uuid,uuid,text)', 'select * into v from violations where id = p_violation for update;', 'perform assert_unit_scope(p_actor, (select business_unit_id from violations where id = p_violation));'),
    ('set_attendance_status(uuid,uuid,text,text)', 'select * into rec from attendance_records where id = p_record_id for update;', 'perform assert_unit_scope(p_actor, (select business_unit_id from attendance_records where id = p_record_id));'),
    ('submit_attendance_amendment(uuid,uuid,text,text,jsonb,text)', 'select * into rec from attendance_records where id = p_record_id for update;', 'perform assert_unit_scope(p_actor, (select business_unit_id from attendance_records where id = p_record_id));')
  ) as t(sig, anchor, add_) loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    if position(r.anchor in v_def) = 0 then raise exception '% no longer contains the expected line', r.sig; end if;
    execute replace(v_def, r.anchor, r.anchor || ' ' || r.add_);
  end loop;
end $$;

-- ------------------------------------------------------------------ access reviews
create table access_review_settings (
  id               boolean primary key default true check (id),
  enabled          boolean not null default true,
  frequency_months int not null default 3 check (frequency_months between 1 and 12),
  updated_by       uuid references users(id),
  updated_at       timestamptz not null default app_now()
);
insert into access_review_settings default values;

create table access_reviews (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  status        text not null default 'OPEN' check (status in ('OPEN', 'SIGNED_OFF')),
  opened_at     timestamptz not null default app_now(),
  opened_by     uuid references users(id),                          -- null: opened by the schedule
  due_at        timestamptz not null,
  signed_off_at timestamptz,
  signed_off_by uuid references users(id),
  attestation   text,
  summary       jsonb,
  check ((status = 'SIGNED_OFF') = (signed_off_at is not null and signed_off_by is not null and attestation is not null))
);
create unique index access_reviews_one_open_idx on access_reviews ((status)) where status = 'OPEN';

create table access_review_items (
  review_id  uuid not null references access_reviews(id) on delete restrict,
  user_id    uuid not null references users(id),
  snapshot   jsonb not null,
  decision   text check (decision in ('KEEP', 'CHANGE', 'SELF')),
  comment    text,
  decided_by uuid references users(id),
  decided_at timestamptz,
  primary key (review_id, user_id),
  check (decision is distinct from 'CHANGE' or (comment is not null and btrim(comment) <> ''))
);
alter table access_review_settings enable row level security;
alter table access_reviews enable row level security;
alter table access_review_items enable row level security;
grant select on access_review_settings, access_reviews, access_review_items to authenticated;
create policy read_managers on access_review_settings for select to authenticated using ((select auth_has_permission('roles.manage')));
create policy read_managers on access_reviews for select to authenticated using ((select auth_has_permission('roles.manage')));
create policy read_managers on access_review_items for select to authenticated using ((select auth_has_permission('roles.manage')));

-- a signed-off review is a record: its lines no longer change
create or replace function guard_access_review_item() returns trigger language plpgsql as $$
begin
  if exists (select 1 from access_reviews where id = old.review_id and status = 'SIGNED_OFF') and coalesce(current_setting('app.review_signoff', true), '') <> 'on' then
    raise exception 'IMMUTABLE_RECORD' using detail = 'a signed-off access review cannot change';
  end if;
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD'; end if;
  return new;
end $$;
create trigger access_review_items_guard before update or delete on access_review_items for each row execute function guard_access_review_item();

create or replace function open_access_review(p_actor uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_n int;
begin
  if p_actor is not null then perform require_permission(p_actor, 'roles.manage'); end if;
  if exists (select 1 from access_reviews where status = 'OPEN') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'an access review is already open'; end if;
  insert into access_reviews (label, opened_by, due_at) values ('Access review ' || to_char(app_now() at time zone 'Africa/Lagos', 'YYYY-MM-DD'), p_actor, app_now() + interval '21 days') returning id into v_id;
  insert into access_review_items (review_id, user_id, snapshot)
  select v_id, u.id, jsonb_build_object(
    'name', coalesce(e.first_name || ' ' || e.last_name, u.email), 'email', u.email, 'unit', b.name,
    'roles', coalesce((select jsonb_agg(r.code order by r.code) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id), '[]'::jsonb),
    'permissions', cardinality(actor_permission_codes(u.id)),
    'critical', (select count(*) from unnest(actor_permission_codes(u.id)) c join permissions p on p.code = c where p.risk = 'critical'),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('permission', p.code, 'expires_at', g.expires_at, 'reason', g.reason)) from user_permission_grants g join permissions p on p.id = g.permission_id where g.user_id = u.id), '[]'::jsonb),
    'units', (select count(*) from user_unit_scopes s where s.user_id = u.id),
    'last_login_at', u.last_login_at)
  from users u left join employees e on e.id = u.employee_id left join business_units b on b.id = e.business_unit_id
  where u.status = 'ACTIVE';
  get diagnostics v_n = row_count;
  perform write_audit(p_actor, 'ACCESS_REVIEW_OPENED', 'access_review', v_id::text, null, jsonb_build_object('people', v_n, 'scheduled', p_actor is null), nullif(btrim(coalesce(p_note, '')), ''));
  perform notify_users(users_with_permission('roles.manage'), 'ACCESS_REVIEW_OPENED', 'access_review', v_id::text, 'An access review is open',
    'Decide for each person whether their access is still right, then sign it off within three weeks.', 'access-review:' || v_id);
  return v_id;
end $$;

create or replace function decide_access_review_item(p_actor uuid, p_review uuid, p_user uuid, p_decision text, p_comment text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform require_permission(p_actor, 'roles.manage');
  if p_decision not in ('KEEP', 'CHANGE') then raise exception 'VALIDATION_ERROR' using detail = 'decide KEEP or CHANGE'; end if;
  if not exists (select 1 from access_reviews where id = p_review and status = 'OPEN') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'this review is not open'; end if;
  if p_user = p_actor then raise exception 'SELF_REVIEW' using detail = 'nobody decides their own access'; end if;
  if p_decision = 'CHANGE' and v_comment is null then raise exception 'REASON_REQUIRED'; end if;
  update access_review_items set decision = p_decision, comment = v_comment, decided_by = p_actor, decided_at = app_now() where review_id = p_review and user_id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform write_audit(p_actor, 'ACCESS_REVIEW_DECISION', 'access_review', p_review::text, null, jsonb_build_object('user', p_user, 'decision', p_decision), v_comment);
end $$;

create or replace function sign_off_access_review(p_actor uuid, p_review uuid, p_attestation text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_att text := nullif(btrim(coalesce(p_attestation, '')), ''); v_open int; v_sum jsonb;
begin
  perform require_permission(p_actor, 'roles.manage');
  if not exists (select 1 from access_reviews where id = p_review and status = 'OPEN') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'this review is not open'; end if;
  if v_att is null or char_length(v_att) < 10 then raise exception 'VALIDATION_ERROR' using detail = 'write a short statement (at least 10 characters) confirming what you reviewed'; end if;
  select count(*) into v_open from access_review_items where review_id = p_review and decision is null and user_id <> p_actor;
  if v_open > 0 then raise exception 'ACCESS_REVIEW_INCOMPLETE' using detail = v_open || ' people still need a decision'; end if;
  perform set_config('app.review_signoff', 'on', true);
  update access_review_items set decision = 'SELF', decided_by = p_actor, decided_at = app_now(), comment = 'The signer does not review their own access' where review_id = p_review and user_id = p_actor and decision is null;
  select jsonb_build_object('people', count(*), 'keep', count(*) filter (where decision = 'KEEP'), 'change', count(*) filter (where decision = 'CHANGE'), 'self', count(*) filter (where decision = 'SELF')) into v_sum from access_review_items where review_id = p_review;
  update access_reviews set status = 'SIGNED_OFF', signed_off_at = app_now(), signed_off_by = p_actor, attestation = v_att, summary = v_sum where id = p_review;
  perform set_config('app.review_signoff', 'off', true);
  perform write_audit(p_actor, 'ACCESS_REVIEW_SIGNED_OFF', 'access_review', p_review::text, null, v_sum, v_att);
  return v_sum;
end $$;

create or replace function set_access_review_schedule(p_actor uuid, p_enabled boolean, p_months int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'roles.manage');
  if p_months is null or p_months not between 1 and 12 then raise exception 'VALIDATION_ERROR' using detail = 'the interval is 1 to 12 months'; end if;
  update access_review_settings set enabled = coalesce(p_enabled, enabled), frequency_months = p_months, updated_by = p_actor, updated_at = app_now() where id;
  perform write_audit(p_actor, 'ACCESS_REVIEW_SCHEDULE_CHANGED', 'access_review_settings', 'schedule', null, jsonb_build_object('enabled', p_enabled, 'months', p_months), null);
end $$;

-- run by the scheduled jobs: open a review when one is due and none is open
create or replace function run_access_review_schedule() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare s access_review_settings; last_open timestamptz;
begin
  select * into s from access_review_settings where id;
  if not s.enabled or exists (select 1 from access_reviews where status = 'OPEN') then return false; end if;
  select max(opened_at) into last_open from access_reviews;
  if last_open is not null and last_open + make_interval(months => s.frequency_months) > app_now() then return false; end if;
  perform open_access_review(null, 'Scheduled review');
  return true;
end $$;

do $$
declare v_def text; v_anchor text := 'begin v_remind := send_report_reminders();';
begin
  v_def := pg_get_functiondef('run_scheduled_jobs()'::regprocedure);
  if position(v_anchor in v_def) = 0 then raise exception 'run_scheduled_jobs no longer contains the expected line'; end if;
  execute replace(v_def, v_anchor, 'begin perform run_access_review_schedule(); exception when others then get stacked diagnostics v_err = message_text; perform write_audit(null, ''JOB_FAILED'', ''job'', ''access_review_schedule'', null, jsonb_build_object(''error'', v_err), null, null, ''FAILURE''); end;' || chr(10) || '  ' || v_anchor);
end $$;

select lock_down_function_grants();
