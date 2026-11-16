-- Business Unit quarterly goals can be locked, and a locked goal changes only through an approved request (ADR-127; owner decisions).
--   * Admin and Super Admin lock a quarter's BU goals: for every unit at once, or for one unit (permission bu_goals.lock). They can unlock, with a reason.
--   * While a unit's goals are locked a BU Lead cannot add, rename, retire or restore a goal (BU_GOALS_LOCKED). The Admin and Super Admin, who can unlock
--     anyway, are not blocked.
--   * The BU Lead asks for the change with a reason (request_bu_goal_change). An Executive, an Admin or HR (bu_goals.approve_change) approves or rejects it;
--     nobody decides their own request. Approval applies the change through save_bu_goal, so its checks and audit still apply.
--   * Everything is audited; the requester is told the outcome.

insert into permissions (code, description, protected, reserved, module, risk) values
  ('bu_goals.lock', 'Lock and unlock a quarter''s Business Unit goals', false, false, 'Strategy', 'high'),
  ('bu_goals.approve_change', 'Approve or reject a Business Unit''s request to change its locked goals', false, false, 'Strategy', 'high')
on conflict (code) do nothing;
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
 where (r.code = 'ADMIN' and p.code in ('bu_goals.lock', 'bu_goals.approve_change')) or (r.code in ('EXECUTIVE', 'HR') and p.code = 'bu_goals.approve_change')
on conflict do nothing;

create table bu_goal_locks (
  id               uuid primary key default gen_random_uuid(),
  quarter_id       uuid not null references quarters(id),
  business_unit_id uuid references business_units(id),            -- null = every unit
  locked_by        uuid not null references users(id),
  locked_at        timestamptz not null default app_now(),
  reason           text,
  unlocked_by      uuid references users(id),
  unlocked_at      timestamptz,
  unlock_reason    text,
  check ((unlocked_at is null) = (unlocked_by is null))
);
create unique index bu_goal_locks_active_idx on bu_goal_locks (quarter_id, coalesce(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)) where unlocked_at is null;
alter table bu_goal_locks enable row level security;

create table bu_goal_change_requests (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id),
  quarter_id       uuid not null references quarters(id),
  kind             text not null check (kind in ('ADD', 'RENAME', 'RETIRE', 'RESTORE')),
  bu_goal_id       uuid references bu_goals(id),
  title            text check (title is null or (btrim(title) <> '' and char_length(title) <= 500)),
  reason           text not null check (btrim(reason) <> '' and char_length(reason) <= 2000),
  status           text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  requested_by     uuid not null references users(id),
  requested_at     timestamptz not null default app_now(),
  decided_by       uuid references users(id),
  decided_at       timestamptz,
  decision_reason  text,
  check ((kind = 'ADD') = (bu_goal_id is null)),
  check (kind not in ('ADD', 'RENAME') or title is not null)
);
create index bu_goal_change_requests_idx on bu_goal_change_requests (quarter_id, business_unit_id, status);
alter table bu_goal_change_requests enable row level security;

create or replace function bu_goals_locked(p_bu uuid, p_quarter uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from bu_goal_locks l where l.quarter_id = p_quarter and l.unlocked_at is null and (l.business_unit_id is null or l.business_unit_id = p_bu));
$$;

create or replace function lock_bu_goals(p_actor uuid, p_quarter uuid, p_bu uuid default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'bu_goals.lock');
  if not exists (select 1 from quarters where id = p_quarter) then raise exception 'NOT_FOUND'; end if;
  if p_bu is not null and not exists (select 1 from business_units where id = p_bu) then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from bu_goal_locks l where l.quarter_id = p_quarter and l.unlocked_at is null and l.business_unit_id is not distinct from p_bu) then
    return jsonb_build_object('locked', true, 'already', true);
  end if;
  insert into bu_goal_locks (quarter_id, business_unit_id, locked_by, reason) values (p_quarter, p_bu, p_actor, v_reason) returning id into v_id;
  perform write_audit(p_actor, 'BU_GOALS_LOCKED', 'bu_goal_lock', v_id::text, null, jsonb_build_object('quarter_id', p_quarter, 'business_unit_id', p_bu, 'scope', case when p_bu is null then 'ALL_UNITS' else 'ONE_UNIT' end), v_reason, p_bu);
  perform notify_users(case when p_bu is null then users_with_role('BU_LEAD') else bu_lead_ids(p_bu) end, 'BU_GOALS_LOCKED', 'bu_goal_lock', v_id::text,
    'Business Unit goals locked', 'Your unit''s goals for the quarter are locked. To change one, send a change request with the reason; an Executive, Admin or HR approves it.', 'bug-lock:' || v_id);
  return jsonb_build_object('locked', true, 'already', false, 'id', v_id);
end $$;

create or replace function unlock_bu_goals(p_actor uuid, p_quarter uuid, p_bu uuid default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_n int;
begin
  perform require_permission(p_actor, 'bu_goals.lock');
  if v_reason is null then raise exception 'VALIDATION_ERROR' using detail = 'a reason is required to unlock goals'; end if;
  update bu_goal_locks set unlocked_by = p_actor, unlocked_at = app_now(), unlock_reason = v_reason
   where quarter_id = p_quarter and unlocked_at is null and (p_bu is null or business_unit_id is not distinct from p_bu);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'NOT_FOUND' using detail = 'there is no lock to remove'; end if;
  perform write_audit(p_actor, 'BU_GOALS_UNLOCKED', 'bu_goal_lock', p_quarter::text, jsonb_build_object('business_unit_id', p_bu), jsonb_build_object('unlocked', v_n), v_reason, p_bu);
  return jsonb_build_object('unlocked', v_n);
end $$;

-- save_bu_goal: refuse a BU Lead while the unit's goals are locked (an approved change request applies through the flag; Admin and Super Admin are not blocked)
do $$
declare v_def text;
  a text := $a$if v_q.status = 'LOCKED' then raise exception 'QUARTER_NOT_ACTIVE' using detail = 'a locked quarter is a closed record'; end if;$a$;
begin
  v_def := pg_get_functiondef('save_bu_goal(uuid,uuid,uuid,uuid,text,text)'::regprocedure);
  if position('bu_goals_locked' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'save_bu_goal changed'; end if;
  execute replace(v_def, a, a || $b$ if bu_goals_locked(v_bu, p_quarter) and coalesce(current_setting('app.bu_goal_change', true), '') <> 'on' and not actor_has_permission(p_actor, 'bu_goals.lock') then raise exception 'BU_GOALS_LOCKED' using detail = 'these goals are locked: send a change request and an Executive, Admin or HR will approve it'; end if;$b$);
end $$;

create or replace function request_bu_goal_change(p_actor uuid, p_bu uuid, p_quarter uuid, p_kind text, p_goal uuid, p_title text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bu uuid := coalesce(p_bu, actor_bu(p_actor)); v_title text := nullif(btrim(coalesce(p_title, '')), ''); v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); g bu_goals; v_id uuid;
begin
  perform require_permission(p_actor, 'bu_goals.manage');
  if not actor_may_file_for(p_actor, v_bu) then raise exception 'BU_SCOPE_DENIED'; end if;
  if p_kind not in ('ADD', 'RENAME', 'RETIRE', 'RESTORE') then raise exception 'VALIDATION_ERROR' using detail = 'kind must be ADD, RENAME, RETIRE or RESTORE'; end if;
  if v_reason is null or char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'a reason of up to 2000 characters is required'; end if;
  if not bu_goals_locked(v_bu, p_quarter) then raise exception 'VALIDATION_ERROR' using detail = 'the goals are not locked: change them directly'; end if;
  if p_kind in ('ADD', 'RENAME') and (v_title is null or char_length(v_title) > 500) then raise exception 'VALIDATION_ERROR' using detail = 'a goal needs a title of up to 500 characters'; end if;
  if p_kind = 'ADD' then p_goal := null; else
    select * into g from bu_goals where id = p_goal;
    if not found or g.business_unit_id <> v_bu or g.quarter_id <> p_quarter then raise exception 'NOT_FOUND' using detail = 'goal'; end if;
    if p_kind = 'RETIRE' and g.status = 'RETIRED' then raise exception 'VALIDATION_ERROR' using detail = 'that goal is already retired'; end if;
    if p_kind = 'RESTORE' and g.status = 'ACTIVE' then raise exception 'VALIDATION_ERROR' using detail = 'that goal is already active'; end if;
  end if;
  insert into bu_goal_change_requests (business_unit_id, quarter_id, kind, bu_goal_id, title, reason, requested_by)
    values (v_bu, p_quarter, p_kind, p_goal, case when p_kind in ('ADD', 'RENAME') then v_title else null end, v_reason, p_actor) returning id into v_id;
  perform write_audit(p_actor, 'BU_GOAL_CHANGE_REQUESTED', 'bu_goal_change_request', v_id::text, case when p_goal is null then null else jsonb_build_object('title', g.title, 'status', g.status) end,
    jsonb_build_object('kind', p_kind, 'title', v_title), v_reason, v_bu);
  perform notify_users(array(select u from unnest(users_with_permission('bu_goals.approve_change')) u where u <> p_actor), 'BU_GOAL_CHANGE_REQUESTED', 'bu_goal_change_request', v_id::text,
    'Business Unit goal change requested', 'A unit has asked to change a locked goal. It is waiting for your decision.', 'bug-req:' || v_id);
  return v_id;
end $$;

create or replace function decide_bu_goal_change(p_actor uuid, p_request uuid, p_approve boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r bu_goal_change_requests; g bu_goals; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'bu_goals.approve_change');
  select * into r from bu_goal_change_requests where id = p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.requested_by = p_actor then raise exception 'BU_GOAL_CHANGE_SELF_APPROVAL'; end if;
  if r.status <> 'PENDING' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'request is ' || r.status; end if;
  if not p_approve and v_reason is null then raise exception 'VALIDATION_ERROR' using detail = 'a reason is required to reject a request'; end if;
  if p_approve then
    perform set_config('app.bu_goal_change', 'on', true);
    if r.bu_goal_id is not null then select * into g from bu_goals where id = r.bu_goal_id; end if;
    perform save_bu_goal(r.requested_by, r.bu_goal_id, r.business_unit_id, r.quarter_id,
      case r.kind when 'ADD' then r.title when 'RENAME' then r.title else g.title end,
      case r.kind when 'RETIRE' then 'RETIRED' when 'RESTORE' then 'ACTIVE' when 'RENAME' then g.status else 'ACTIVE' end);
    perform set_config('app.bu_goal_change', 'off', true);
  end if;
  update bu_goal_change_requests set status = case when p_approve then 'APPROVED' else 'REJECTED' end, decided_by = p_actor, decided_at = app_now(), decision_reason = v_reason where id = p_request;
  perform write_audit(p_actor, case when p_approve then 'BU_GOAL_CHANGE_APPROVED' else 'BU_GOAL_CHANGE_REJECTED' end, 'bu_goal_change_request', p_request::text,
    jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', case when p_approve then 'APPROVED' else 'REJECTED' end, 'kind', r.kind), v_reason, r.business_unit_id);
  perform notify_users(array[r.requested_by], case when p_approve then 'BU_GOAL_CHANGE_APPROVED' else 'BU_GOAL_CHANGE_REJECTED' end, 'bu_goal_change_request', p_request::text,
    case when p_approve then 'Goal change approved' else 'Goal change rejected' end,
    case when p_approve then 'Your change to the unit goals was approved and is now in place.' else 'Your change request was rejected. Reason: ' || v_reason end, 'bug-dec:' || p_request);
  return jsonb_build_object('request_id', p_request, 'decision', case when p_approve then 'APPROVED' else 'REJECTED' end);
end $$;

create or replace function withdraw_bu_goal_change(p_actor uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r bu_goal_change_requests;
begin
  select * into r from bu_goal_change_requests where id = p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.requested_by <> p_actor then raise exception 'PERMISSION_DENIED'; end if;
  if r.status <> 'PENDING' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'request is ' || r.status; end if;
  update bu_goal_change_requests set status = 'WITHDRAWN', decided_by = p_actor, decided_at = app_now() where id = p_request;
  perform write_audit(p_actor, 'BU_GOAL_CHANGE_WITHDRAWN', 'bu_goal_change_request', p_request::text, jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'WITHDRAWN'), null, r.business_unit_id);
  return jsonb_build_object('request_id', p_request, 'status', 'WITHDRAWN');
end $$;

-- reads (read_ names are callable by signed-in people; these decide what the caller may see themselves)
create or replace function read_bu_goal_lock_state(p_quarter uuid, p_bu uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l bu_goal_locks;
begin
  if auth.uid() is null then raise exception 'PERMISSION_DENIED'; end if;
  select * into l from bu_goal_locks x where x.quarter_id = p_quarter and x.unlocked_at is null and (x.business_unit_id is null or x.business_unit_id = p_bu)
   order by (x.business_unit_id is null) desc limit 1;
  if not found then return jsonb_build_object('locked', false); end if;
  return jsonb_build_object('locked', true, 'scope', case when l.business_unit_id is null then 'ALL_UNITS' else 'ONE_UNIT' end, 'locked_at', l.locked_at, 'reason', l.reason);
end $$;

create or replace function read_bu_goal_change_requests(p_quarter uuid, p_bu uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_all boolean;
begin
  if auth.uid() is null then raise exception 'PERMISSION_DENIED'; end if;
  v_all := auth_has_permission('bu_goals.approve_change') or auth_has_permission('bu_goals.lock');
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'title', r.title, 'reason', r.reason, 'bu_goal_id', r.bu_goal_id,
      'goal_title', (select g.title from bu_goals g where g.id = r.bu_goal_id), 'business_unit_id', r.business_unit_id, 'unit', (select b.name from business_units b where b.id = r.business_unit_id),
      'requested_at', r.requested_at, 'requested_by', r.requested_by,
      'requester', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.requested_by),
      'decided_at', r.decided_at, 'decision_reason', r.decision_reason,
      'decider', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.decided_by),
      'mine', r.requested_by = auth.uid()) order by (r.status = 'PENDING') desc, r.requested_at desc)
    from bu_goal_change_requests r
   where r.quarter_id = p_quarter and (p_bu is null or r.business_unit_id = p_bu) and (v_all or auth_can_view_bu(r.business_unit_id))), '[]'::jsonb);
end $$;

select lock_down_function_grants();

-- bulk upload: a BU Lead adds many goals for the quarter from a file. All or nothing, each goal through save_bu_goal (so scope, lock, quarter and duplicate checks apply)
create or replace function bulk_save_bu_goals(p_actor uuid, p_bu uuid, p_quarter uuid, p_titles jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t text; n int := 0; v_bu uuid := coalesce(p_bu, actor_bu(p_actor));
begin
  perform require_permission(p_actor, 'bu_goals.manage');
  if p_titles is null or jsonb_typeof(p_titles) <> 'array' or jsonb_array_length(p_titles) = 0 or jsonb_array_length(p_titles) > 100 then
    raise exception 'VALIDATION_ERROR' using detail = 'upload between 1 and 100 goals';
  end if;
  for t in select jsonb_array_elements_text(p_titles) loop
    perform save_bu_goal(p_actor, null, v_bu, p_quarter, t, 'ACTIVE');
    n := n + 1;
  end loop;
  perform write_audit(p_actor, 'BU_GOALS_UPLOADED', 'bu_goal', p_quarter::text, null, jsonb_build_object('count', n), null, v_bu);
  return jsonb_build_object('created', n);
end $$;

select lock_down_function_grants();
