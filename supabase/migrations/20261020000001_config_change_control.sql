-- Approval for configuration changes (ADR-068, docs/30 E-04, E-03).
-- One generic request -> different person decides -> applied atomically workflow for governance-critical configuration.
-- Topics are DATA (config_change_topics); each topic names who may ask and who may approve. The change itself is applied by calling the
-- EXISTING function for that setting as the requester, so every validation, permission check and audit entry of that function still runs.
-- A request is validated when it is made by running the same function inside a sub-transaction that is always rolled back (a "dry run").

insert into permissions (code, description) values
  ('config.approve',           'Approve or reject a configuration change requested by someone else'),
  ('config.protected.approve', 'Approve a configuration change that touches protected permissions or protected settings (needs a fresh authenticator check)'),
  ('config.emergency',         'Apply a configuration change in one step in an emergency (audited and alerted)')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('ADMIN','config.approve'), ('SUPER_ADMIN','config.approve'),
  ('SUPER_ADMIN','config.protected.approve'), ('SUPER_ADMIN','config.emergency'),
  ('SUPER_ADMIN','violation.edit')                                   -- owner decision of 15 October 2026: HR, Admin and Super Admin edit violation types
) v(role_code, perm) join roles r on r.code = v.role_code join permissions p on p.code = v.perm
on conflict do nothing;

create table config_change_topics (
  code               text primary key,
  description        text not null,
  request_permission text not null references permissions(code),
  approve_permission text not null references permissions(code),
  protected          boolean not null default false
);
insert into config_change_topics (code, description, request_permission, approve_permission, protected) values
  ('VIOLATION_TYPE',    'Add or change a violation type and its fine',           'violation.edit',              'config.approve', false),
  ('PENALTY_RATE',      'Change the integrity penalty rate',                     'integrity_penalty.configure', 'config.approve', false),
  ('REMINDER_SETTINGS', 'Change reminder and email settings',                    'reminders.configure',         'config.approve', false),
  ('BU_REPORTING',      'Change a Business Unit''s status or weekly reporting',  'business_units.manage',       'config.approve', false);

-- target: what the change is about. VIOLATION_TYPE: the new code (CREATE) or the type's id (UPDATE); BU_REPORTING: the Business Unit's id.
create table config_change_requests (
  id               uuid primary key default gen_random_uuid(),
  topic            text not null references config_change_topics(code),
  target           text,
  proposed         jsonb not null,
  current_value    jsonb,
  reason           text not null check (btrim(reason) <> ''),
  status           text not null default 'PENDING' check (status in ('PENDING','APPLIED','REJECTED','WITHDRAWN')),
  emergency        boolean not null default false,
  requested_by     uuid not null references users(id),
  idempotency_key  text not null unique,
  decided_by       uuid references users(id),
  decided_at       timestamptz,
  decision_comment text,
  decision_key     text unique,
  created_at       timestamptz not null default app_now(),
  check ((status = 'PENDING') = (decided_at is null)),
  check (status <> 'REJECTED' or (decision_comment is not null and btrim(decision_comment) <> '')),
  check (decided_by is null or decided_by <> requested_by or emergency or status = 'WITHDRAWN')
);
create unique index config_change_one_pending on config_change_requests (topic, coalesce(target, '')) where status = 'PENDING';
create index config_change_time_idx on config_change_requests (created_at desc);

create or replace function config_change_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'configuration change requests are never deleted'; end if;
  if old.status <> 'PENDING' then raise exception 'IMMUTABLE_RECORD' using detail = 'a decided request cannot change'; end if;
  if new.topic <> old.topic or new.target is distinct from old.target or new.proposed <> old.proposed or new.reason <> old.reason
     or new.requested_by <> old.requested_by or new.idempotency_key <> old.idempotency_key or new.created_at <> old.created_at then
    raise exception 'IMMUTABLE_RECORD' using detail = 'only the decision can be recorded';
  end if;
  return new;
end $$;
create trigger config_change_requests_guard before update or delete on config_change_requests for each row execute function config_change_guard();

-- the value in force now, stored with the request so the approver sees what would change
create or replace function config_current_value(p_topic text, p_target text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_topic
    when 'VIOLATION_TYPE'    then (select to_jsonb(v) from violation_types v where p_target is not null and (v.id::text = p_target or v.code = upper(p_target)))
    when 'PENALTY_RATE'      then (select to_jsonb(c) from integrity_penalty_configurations c where c.effective_to is null order by c.created_at desc limit 1)
    when 'REMINDER_SETTINGS' then (select to_jsonb(s) from notification_settings s where s.id)
    when 'BU_REPORTING'      then (select to_jsonb(b) from business_units b where p_target is not null and b.id = p_target::uuid)
    else null end;
end $$;

-- does this request need a Super Admin? (topic flag here; later topics add their own rules by replacing this function)
create or replace function config_change_is_protected(p_topic text, p_proposed jsonb) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select protected from config_change_topics where code = p_topic), false);
$$;

-- applies a change by calling the existing function for that setting AS THE REQUESTER (so its own checks and audit still run)
create or replace function apply_config_change(r config_change_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := r.proposed;
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
    else raise exception 'VALIDATION_ERROR' using detail = 'unknown configuration topic ' || r.topic;
  end case;
exception when invalid_text_representation or numeric_value_out_of_range or null_value_not_allowed or invalid_parameter_value then
  raise exception 'VALIDATION_ERROR' using detail = 'the proposed values are not valid for this setting';
end $$;

-- validates a proposal exactly as applying it would, then undoes everything it did
create or replace function config_dry_run(r config_change_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform apply_config_change(r);
    raise exception 'CONFIG_DRY_RUN';
  exception when others then
    if sqlerrm <> 'CONFIG_DRY_RUN' then raise; end if;
  end;
end $$;

create or replace function request_config_change(p_actor uuid, p_topic text, p_target text, p_proposed jsonb, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t config_change_topics; v_ex config_change_requests; r config_change_requests; v_id uuid;
begin
  select * into t from config_change_topics where code = p_topic;
  if not found then raise exception 'VALIDATION_ERROR' using detail = 'unknown configuration topic'; end if;
  perform require_permission(p_actor, t.request_permission);
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  if p_proposed is null or jsonb_typeof(p_proposed) <> 'object' then raise exception 'VALIDATION_ERROR' using detail = 'the proposed values are required'; end if;
  select * into v_ex from config_change_requests where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.requested_by <> p_actor or v_ex.topic <> p_topic or v_ex.target is distinct from p_target then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_ex.id, 'status', v_ex.status);
  end if;
  if exists (select 1 from config_change_requests where topic = p_topic and coalesce(target, '') = coalesce(p_target, '') and status = 'PENDING') then
    raise exception 'CONFIG_CHANGE_PENDING';
  end if;
  r.id := gen_random_uuid(); r.topic := p_topic; r.target := p_target; r.proposed := p_proposed; r.requested_by := p_actor; r.status := 'PENDING';
  perform config_dry_run(r);                                           -- raises the setting's own validation error now, not at approval
  insert into config_change_requests (topic, target, proposed, current_value, reason, requested_by, idempotency_key)
    values (p_topic, p_target, p_proposed, config_current_value(p_topic, p_target), btrim(p_reason), p_actor, p_idempotency_key) returning id into v_id;
  perform write_audit(p_actor, 'CONFIG_CHANGE_REQUESTED', 'config_change_request', v_id::text, null, jsonb_build_object('topic', p_topic, 'target', p_target, 'proposed', p_proposed), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission(case when config_change_is_protected(p_topic, p_proposed) then 'config.protected.approve' else t.approve_permission end), p_actor),
    'CONFIG_CHANGE_REQUESTED', 'config_change_request', v_id::text, 'A configuration change needs your decision',
    t.description || '. Reason given: ' || btrim(p_reason), 'cfg-req:' || v_id);
  return jsonb_build_object('replayed', false, 'request_id', v_id, 'status', 'PENDING');
end $$;

create or replace function decide_config_change(p_actor uuid, p_request_id uuid, p_decision text, p_comment text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r config_change_requests; t config_change_topics; v_prev config_change_requests;
begin
  if p_decision is null or p_decision not in ('APPROVE','REJECT') then raise exception 'VALIDATION_ERROR' using detail = 'decision must be APPROVE or REJECT'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_prev from config_change_requests where decision_key = p_idempotency_key;
  if found then
    if v_prev.id <> p_request_id or v_prev.decided_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_prev.id, 'status', v_prev.status);
  end if;
  if not (actor_has_permission(p_actor, 'config.approve') or actor_has_permission(p_actor, 'config.protected.approve')) then raise exception 'PERMISSION_DENIED'; end if;   -- before looking anything up
  select * into r from config_change_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into t from config_change_topics where code = r.topic;
  perform require_permission(p_actor, t.approve_permission);
  if config_change_is_protected(r.topic, r.proposed) then perform require_permission(p_actor, 'config.protected.approve'); end if;
  if r.status <> 'PENDING' then raise exception 'CONFIG_CHANGE_NOT_PENDING'; end if;
  if r.requested_by = p_actor then raise exception 'CONFIG_CHANGE_SELF_APPROVAL'; end if;
  if p_decision = 'REJECT' then
    if p_comment is null or btrim(p_comment) = '' then raise exception 'REASON_REQUIRED'; end if;
    update config_change_requests set status = 'REJECTED', decided_by = p_actor, decided_at = app_now(), decision_comment = btrim(p_comment), decision_key = p_idempotency_key where id = r.id;
    perform write_audit(p_actor, 'CONFIG_CHANGE_REJECTED', 'config_change_request', r.id::text, jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'REJECTED'), btrim(p_comment));
    perform notify_users(array[r.requested_by], 'CONFIG_CHANGE_DECIDED', 'config_change_request', r.id::text, 'Your configuration change was rejected', 'Reason: ' || btrim(p_comment), 'cfg-dec:' || r.id);
    return jsonb_build_object('replayed', false, 'request_id', r.id, 'status', 'REJECTED');
  end if;
  perform apply_config_change(r);                                      -- the setting's own checks run again, now; a failure undoes the approval too
  update config_change_requests set status = 'APPLIED', decided_by = p_actor, decided_at = app_now(), decision_comment = nullif(btrim(coalesce(p_comment, '')), ''), decision_key = p_idempotency_key where id = r.id;
  perform write_audit(p_actor, 'CONFIG_CHANGE_APPLIED', 'config_change_request', r.id::text, jsonb_build_object('status', 'PENDING', 'value', r.current_value), jsonb_build_object('status', 'APPLIED', 'topic', r.topic, 'proposed', r.proposed), nullif(btrim(coalesce(p_comment, '')), ''));
  perform notify_users(array[r.requested_by], 'CONFIG_CHANGE_DECIDED', 'config_change_request', r.id::text, 'Your configuration change was approved and applied', t.description, 'cfg-dec:' || r.id);
  return jsonb_build_object('replayed', false, 'request_id', r.id, 'status', 'APPLIED');
end $$;

create or replace function withdraw_config_change(p_actor uuid, p_request_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r config_change_requests;
begin
  select * into r from config_change_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.requested_by <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the person who asked can withdraw a request'; end if;
  if r.status <> 'PENDING' then raise exception 'CONFIG_CHANGE_NOT_PENDING'; end if;
  update config_change_requests set status = 'WITHDRAWN', decided_by = p_actor, decided_at = app_now() where id = r.id;
  perform write_audit(p_actor, 'CONFIG_CHANGE_WITHDRAWN', 'config_change_request', r.id::text, jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'WITHDRAWN'), null);
end $$;

-- Emergency: a Super Admin applies a change without a second approver. Reason of at least 10 characters; the API also demands a fresh authenticator code.
create or replace function emergency_config_change(p_actor uuid, p_topic text, p_target text, p_proposed jsonb, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t config_change_topics; v_ex config_change_requests; r config_change_requests; v_id uuid := gen_random_uuid();
begin
  perform require_permission(p_actor, 'config.emergency');
  select * into t from config_change_topics where code = p_topic;
  if not found then raise exception 'VALIDATION_ERROR' using detail = 'unknown configuration topic'; end if;
  perform require_permission(p_actor, t.request_permission);
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'VALIDATION_ERROR' using detail = 'an emergency change needs a reason of at least 10 characters'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_ex from config_change_requests where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.requested_by <> p_actor or v_ex.topic <> p_topic then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_ex.id, 'status', v_ex.status);
  end if;
  if p_proposed is null or jsonb_typeof(p_proposed) <> 'object' then raise exception 'VALIDATION_ERROR' using detail = 'the proposed values are required'; end if;
  r.id := v_id; r.topic := p_topic; r.target := p_target; r.proposed := p_proposed; r.requested_by := p_actor; r.status := 'APPLIED'; r.reason := btrim(p_reason);
  update config_change_requests set status = 'REJECTED', decided_by = p_actor, decided_at = app_now(), decision_comment = 'Superseded by an emergency change'
    where topic = p_topic and coalesce(target, '') = coalesce(p_target, '') and status = 'PENDING' and requested_by <> p_actor;
  update config_change_requests set status = 'WITHDRAWN', decided_by = p_actor, decided_at = app_now()
    where topic = p_topic and coalesce(target, '') = coalesce(p_target, '') and status = 'PENDING' and requested_by = p_actor;
  perform apply_config_change(r);
  insert into config_change_requests (id, topic, target, proposed, current_value, reason, status, emergency, requested_by, idempotency_key, decided_by, decided_at, decision_key)
    values (v_id, p_topic, p_target, p_proposed, config_current_value(p_topic, p_target), btrim(p_reason), 'APPLIED', true, p_actor, p_idempotency_key, p_actor, app_now(), p_idempotency_key);
  perform write_audit(p_actor, 'CONFIG_CHANGE_EMERGENCY', 'config_change_request', v_id::text, null, jsonb_build_object('topic', p_topic, 'target', p_target, 'proposed', p_proposed), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission('config.emergency') || users_with_permission('config.approve'), p_actor), 'CONFIG_CHANGE_EMERGENCY', 'config_change_request', v_id::text,
    'Emergency configuration change applied', t.description || '. Reason: ' || btrim(p_reason), 'cfg-emg:' || v_id);
  return jsonb_build_object('replayed', false, 'request_id', v_id, 'status', 'APPLIED');
end $$;

-- the queue and history, read under the caller's own row-level security
create or replace function read_config_changes(p_limit int default 100) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select c.id, c.topic, t.description as topic_description, c.target, c.proposed, c.current_value, c.reason, c.status, c.emergency, c.requested_by,
           coalesce(re.first_name || ' ' || re.last_name, ru.email::text) as requested_by_name, c.decided_by,
           coalesce(de.first_name || ' ' || de.last_name, du.email::text) as decided_by_name, c.decided_at, c.decision_comment, c.created_at, t.protected as topic_protected
      from config_change_requests c join config_change_topics t on t.code = c.topic
      join users ru on ru.id = c.requested_by left join employees re on re.id = ru.employee_id
      left join users du on du.id = c.decided_by left join employees de on de.id = du.employee_id
     order by c.created_at desc limit least(greatest(p_limit, 1), 500)
  ) x;
$$;

alter table config_change_topics enable row level security;
alter table config_change_requests enable row level security;
grant select on config_change_topics, config_change_requests to authenticated;
create policy read_all on config_change_topics for select to authenticated using (true);
create policy read_scoped on config_change_requests for select to authenticated
  using ((select auth_has_any(array['config.approve','config.protected.approve','config.emergency','violation.edit','integrity_penalty.configure','reminders.configure','business_units.manage'])));

select lock_down_function_grants();
