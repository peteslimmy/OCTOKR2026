-- A Business Unit goal is retired only through an approval by the executive the BU Lead names (ADR-134; owner decision, 2026-11-24).
--   * The lead chooses an executive by name, gives a justification, and the goal stays exactly as it is until that executive approves.
--     The executive may reject; a rejection carries a comment. A rejected or cancelled request changes nothing.
--   * Who may be chosen: an active person who holds bu_goals.approve_retirement (the EXECUTIVE role only; the Super Admin holds it too but
--     is never offered, ADR-118) and is not the requester. Who may decide: the chosen executive, and the Super Admin (ADR-112: no limit; the
--     act is audited as done on the chosen executive's behalf and the people involved are told "an administrator").
--   * save_bu_goal no longer retires a goal for anyone but the Super Admin; the older "request a change to a locked goal" no longer takes
--     RETIRE (an approval of such a request that was already pending is refused: retirement has its own workflow).
--   * History is never deleted: a request row is immutable once decided, nothing can delete one, and approving retires the goal exactly as
--     before (status only: weekly goals that point at it, scores and past reports are untouched).

insert into permissions (code, description, protected, reserved, module, risk) values
  ('bu_goals.approve_retirement', 'Approve or reject the retirement of a Business Unit goal that a BU Lead sent to you by name', false, false, 'Strategy', 'high')
on conflict (code) do nothing;
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'EXECUTIVE' and p.code = 'bu_goals.approve_retirement'
on conflict do nothing;
-- the Super Admin holds every permission (ADR-125): the trigger grants this one when it is inserted

create table bu_goal_retirement_requests (
  id               uuid primary key default gen_random_uuid(),
  bu_goal_id       uuid not null references bu_goals(id),
  business_unit_id uuid not null references business_units(id),
  quarter_id       uuid not null references quarters(id),
  requested_by     uuid not null references users(id),
  executive_id     uuid not null references users(id),
  justification    text not null check (btrim(justification) <> '' and char_length(justification) <= 2000),
  status           text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_at     timestamptz not null default app_now(),
  decided_by       uuid references users(id),
  decided_at       timestamptz,
  decision_comment text check (decision_comment is null or char_length(decision_comment) <= 2000),
  idempotency_key  text unique,
  check ((status = 'PENDING') = (decided_at is null)),
  check ((decided_at is null) = (decided_by is null)),
  check (status <> 'REJECTED' or (decision_comment is not null and btrim(decision_comment) <> '')),
  check (executive_id <> requested_by)
);
create unique index bu_goal_retirement_open_idx on bu_goal_retirement_requests (bu_goal_id) where status = 'PENDING';
create index bu_goal_retirement_exec_idx on bu_goal_retirement_requests (executive_id, status);
create index bu_goal_retirement_unit_idx on bu_goal_retirement_requests (quarter_id, business_unit_id);
alter table bu_goal_retirement_requests enable row level security;

-- history is kept: a decided request never changes, and no request is ever deleted
create or replace function bu_goal_retirement_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'retirement requests are never deleted'; end if;
  if old.status <> 'PENDING' then raise exception 'IMMUTABLE_RECORD' using detail = 'a decided retirement request does not change'; end if;
  if new.bu_goal_id <> old.bu_goal_id or new.business_unit_id <> old.business_unit_id or new.quarter_id <> old.quarter_id or new.requested_by <> old.requested_by
     or new.executive_id <> old.executive_id or new.justification <> old.justification or new.requested_at <> old.requested_at then
    raise exception 'IMMUTABLE_RECORD' using detail = 'only the decision can be recorded on a retirement request';
  end if;
  return new;
end $$;
create trigger bu_goal_retirement_guard_trg before update or delete on bu_goal_retirement_requests for each row execute function bu_goal_retirement_guard();

-- a goal is retired only through an approved request (the Super Admin has no limit, ADR-112); the approval sets app.bu_goal_retirement itself
do $$
declare v_def text;
  a text := $a$if v_title = '' or char_length(v_title) > 500 then raise exception 'VALIDATION_ERROR' using detail = 'a goal needs a title of up to 500 characters'; end if;$a$;
begin
  v_def := pg_get_functiondef('save_bu_goal(uuid,uuid,uuid,uuid,text,text)'::regprocedure);
  if position('bu_goal_retirement' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'save_bu_goal changed'; end if;
  execute replace(v_def, a, $b$if v_status = 'RETIRED' and coalesce(current_setting('app.bu_goal_retirement', true), '') <> 'on' and not is_super_admin(p_actor) then
    if p_id is null then raise exception 'BU_GOAL_RETIRE_REQUIRES_APPROVAL' using detail = 'a goal is retired only when the executive you choose approves: use Retire and pick the executive'; end if;
    if g.status <> 'RETIRED' then raise exception 'BU_GOAL_RETIRE_REQUIRES_APPROVAL' using detail = 'a goal is retired only when the executive you choose approves: use Retire and pick the executive'; end if;
  end if;
  $b$ || a);
end $$;

-- the older change request for a locked goal no longer carries a retirement
do $$
declare v_def text;
  a text := $a$if p_kind not in ('ADD', 'RENAME', 'RETIRE', 'RESTORE') then raise exception 'VALIDATION_ERROR' using detail = 'kind must be ADD, RENAME, RETIRE or RESTORE'; end if;$a$;
  c text := $c$perform set_config('app.bu_goal_change', 'on', true);$c$;
begin
  v_def := pg_get_functiondef('request_bu_goal_change(uuid,uuid,uuid,text,uuid,text,text)'::regprocedure);
  if position('executive retirement request' in v_def) = 0 then
    if position(a in v_def) = 0 then raise exception 'request_bu_goal_change changed'; end if;
    execute replace(v_def, a, a || $b$ if p_kind = 'RETIRE' then raise exception 'VALIDATION_ERROR' using detail = 'a goal is retired through the executive retirement request: choose Retire on the goal'; end if;$b$);
  end if;
  v_def := pg_get_functiondef('decide_bu_goal_change(uuid,uuid,boolean,text)'::regprocedure);
  if position('executive retirement request' in v_def) = 0 then
    if position(c in v_def) = 0 then raise exception 'decide_bu_goal_change changed'; end if;
    execute replace(v_def, c, $b$if r.kind = 'RETIRE' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'a retirement is approved only through the executive retirement request: reject this one and ask again with Retire'; end if;
    $b$ || c);
  end if;
end $$;

-- who may be chosen
create or replace function bu_goal_retirement_executives(p_exclude uuid default null) returns table (id uuid, name text, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, e.first_name || ' ' || e.last_name,
         'EXECUTIVE'
    from users u join employees e on e.id = u.employee_id
   where u.status = 'ACTIVE' and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.code = 'EXECUTIVE') and actor_has_permission(u.id, 'bu_goals.approve_retirement') and not is_super_admin(u.id) and u.id is distinct from p_exclude
   order by e.first_name, e.last_name;
$$;

create or replace function read_bu_goal_retirement_executives() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'PERMISSION_DENIED'; end if;
  if not auth_has_permission('bu_goals.manage') then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'role', x.role) order by x.name) from bu_goal_retirement_executives(auth.uid()) x), '[]'::jsonb);
end $$;

create or replace function request_bu_goal_retirement(p_actor uuid, p_goal uuid, p_executive uuid, p_justification text, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g bu_goals; v_q quarters; v_just text := nullif(btrim(coalesce(p_justification, '')), ''); v_id uuid; r bu_goal_retirement_requests;
begin
  perform require_permission(p_actor, 'bu_goals.manage');
  select * into g from bu_goals where id = p_goal for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'goal'; end if;
  if not actor_may_file_for(p_actor, g.business_unit_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  -- one open request per goal: a repeat returns it (also when the same key is sent again)
  select * into r from bu_goal_retirement_requests where bu_goal_id = p_goal and status = 'PENDING';
  if found then return jsonb_build_object('id', r.id, 'status', r.status, 'executive_id', r.executive_id, 'existing', true); end if;
  if p_idempotency_key is not null then
    select * into r from bu_goal_retirement_requests where idempotency_key = p_idempotency_key and requested_by = p_actor;
    if found then return jsonb_build_object('id', r.id, 'status', r.status, 'executive_id', r.executive_id, 'existing', true); end if;
  end if;
  if g.status = 'RETIRED' then raise exception 'VALIDATION_ERROR' using detail = 'that goal is already retired'; end if;
  select * into v_q from quarters where id = g.quarter_id;
  if v_q.status = 'LOCKED' then raise exception 'QUARTER_NOT_ACTIVE' using detail = 'a locked quarter is a closed record'; end if;
  if v_just is null or char_length(v_just) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'a justification of up to 2000 characters is required'; end if;
  if p_executive is null or p_executive = p_actor or not exists (select 1 from bu_goal_retirement_executives(p_actor) x where x.id = p_executive) then
    raise exception 'VALIDATION_ERROR' using detail = 'choose an executive from the list';
  end if;
  insert into bu_goal_retirement_requests (bu_goal_id, business_unit_id, quarter_id, requested_by, executive_id, justification, idempotency_key)
    values (g.id, g.business_unit_id, g.quarter_id, p_actor, p_executive, v_just, p_idempotency_key) returning id into v_id;
  perform write_audit(p_actor, 'BU_GOAL_RETIREMENT_REQUESTED', 'bu_goal_retirement_request', v_id::text, jsonb_build_object('title', g.title, 'status', g.status),
    jsonb_build_object('executive_id', p_executive, 'goal_id', g.id), v_just, g.business_unit_id);
  perform notify_users(array[p_executive], 'BU_GOAL_RETIREMENT_REQUESTED', 'bu_goal_retirement_request', v_id::text,
    'A goal retirement waits for you', 'A Business Unit Lead asks you to approve retiring a goal: ' || g.title || '. The goal stays as it is until you decide.', 'bgr-req:' || v_id);
  return jsonb_build_object('id', v_id, 'status', 'PENDING', 'executive_id', p_executive, 'existing', false);
exception when unique_violation then
  select * into r from bu_goal_retirement_requests where bu_goal_id = p_goal and status = 'PENDING';
  if found then return jsonb_build_object('id', r.id, 'status', r.status, 'executive_id', r.executive_id, 'existing', true); end if;
  raise;
end $$;

create or replace function decide_bu_goal_retirement(p_actor uuid, p_request uuid, p_approve boolean, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r bu_goal_retirement_requests; g bu_goals; v_comment text := nullif(btrim(coalesce(p_comment, '')), ''); v_new text; v_proxy boolean; v_who text;
begin
  perform require_permission(p_actor, 'bu_goals.approve_retirement');
  if p_approve is null then raise exception 'VALIDATION_ERROR' using detail = 'say whether to approve or reject'; end if;
  select * into r from bu_goal_retirement_requests where id = p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_proxy := r.executive_id <> p_actor;
  -- only the chosen executive decides; the Super Admin, who has no limit (ADR-112), may too, and it is recorded as done on the executive's behalf
  if v_proxy and not is_super_admin(p_actor) then raise exception 'PERMISSION_DENIED' using detail = 'this request was sent to another executive'; end if;
  if r.requested_by = p_actor then raise exception 'BU_GOAL_CHANGE_SELF_APPROVAL'; end if;
  v_new := case when p_approve then 'APPROVED' else 'REJECTED' end;
  if r.status <> 'PENDING' then
    if r.status = v_new and r.decided_by = p_actor then return jsonb_build_object('request_id', p_request, 'decision', r.status, 'replay', true); end if;
    raise exception 'INVALID_STATE_TRANSITION' using detail = 'request is ' || r.status;
  end if;
  if not p_approve and v_comment is null then raise exception 'VALIDATION_ERROR' using detail = 'a comment is required to reject a retirement'; end if;
  select * into g from bu_goals where id = r.bu_goal_id for update;
  if p_approve then
    if g.status <> 'ACTIVE' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'the goal is no longer active: reject this request'; end if;
    if (select status from quarters where id = g.quarter_id) = 'LOCKED' then raise exception 'QUARTER_NOT_ACTIVE' using detail = 'a locked quarter is a closed record'; end if;
    -- exactly what the direct retirement did: the status changes, nothing else (weekly goals that point at it, scores and reports stay)
    update bu_goals set status = 'RETIRED', updated_at = app_now() where id = g.id;
    perform write_audit(p_actor, 'BU_GOAL_RETIRED', 'bu_goal', g.id::text, jsonb_build_object('title', g.title, 'status', g.status), jsonb_build_object('title', g.title, 'status', 'RETIRED'),
      'Approved retirement request ' || r.id::text, g.business_unit_id);
  end if;
  update bu_goal_retirement_requests set status = v_new, decided_by = p_actor, decided_at = app_now(), decision_comment = v_comment where id = p_request;
  perform write_audit(p_actor, case when p_approve then 'BU_GOAL_RETIREMENT_APPROVED' else 'BU_GOAL_RETIREMENT_REJECTED' end, 'bu_goal_retirement_request', p_request::text,
    jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', v_new, 'chosen_executive_id', r.executive_id, 'decided_on_behalf_of_chosen_executive', v_proxy), v_comment, r.business_unit_id);
  v_who := case when v_proxy then 'an administrator' else 'the executive you chose' end;
  perform notify_users(array[r.requested_by], case when p_approve then 'BU_GOAL_RETIREMENT_APPROVED' else 'BU_GOAL_RETIREMENT_REJECTED' end, 'bu_goal_retirement_request', p_request::text,
    case when p_approve then 'Goal retirement approved' else 'Goal retirement rejected' end,
    case when p_approve then 'The goal "' || g.title || '" was retired by ' || v_who || '.'
         else 'Your request to retire a goal was rejected by ' || v_who || '. The goal stays active. Comment: ' || v_comment end, 'bgr-dec:' || p_request);
  if v_proxy then
    perform notify_users(array[r.executive_id], 'BU_GOAL_RETIREMENT_DECIDED', 'bu_goal_retirement_request', p_request::text, 'A goal retirement sent to you was decided',
      'An administrator ' || case when p_approve then 'approved' else 'rejected' end || ' a goal retirement that was waiting for you.', 'bgr-proxy:' || p_request);
  end if;
  return jsonb_build_object('request_id', p_request, 'decision', v_new, 'replay', false);
end $$;

create or replace function cancel_bu_goal_retirement(p_actor uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r bu_goal_retirement_requests;
begin
  select * into r from bu_goal_retirement_requests where id = p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.requested_by <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the person who asked can cancel the request'; end if;
  if r.status = 'CANCELLED' then return jsonb_build_object('request_id', p_request, 'status', 'CANCELLED', 'replay', true); end if;
  if r.status <> 'PENDING' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'request is ' || r.status; end if;
  update bu_goal_retirement_requests set status = 'CANCELLED', decided_by = p_actor, decided_at = app_now() where id = p_request;
  perform write_audit(p_actor, 'BU_GOAL_RETIREMENT_CANCELLED', 'bu_goal_retirement_request', p_request::text, jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'CANCELLED'), null, r.business_unit_id);
  perform notify_users(array[r.executive_id], 'BU_GOAL_RETIREMENT_CANCELLED', 'bu_goal_retirement_request', p_request::text, 'A goal retirement was cancelled',
    'The Business Unit Lead cancelled the retirement request that was waiting for you.', 'bgr-can:' || p_request);
  return jsonb_build_object('request_id', p_request, 'status', 'CANCELLED', 'replay', false);
end $$;

-- the requests for a quarter: the unit's people, the chosen executive and the Super Admin see them (a hidden Super Admin's name is never shown)
create or replace function read_bu_goal_retirements(p_quarter uuid default null, p_bu uuid default null, p_mine_to_decide boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_sa boolean;
begin
  if auth.uid() is null then raise exception 'PERMISSION_DENIED'; end if;
  v_sa := is_super_admin(auth.uid());
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'bu_goal_id', r.bu_goal_id, 'goal_title', g.title, 'goal_code', g.code, 'business_unit_id', r.business_unit_id,
      'unit', (select b.name from business_units b where b.id = r.business_unit_id), 'quarter_id', r.quarter_id,
      'status', r.status, 'justification', r.justification, 'requested_at', r.requested_at, 'requested_by', r.requested_by,
      'requester', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.requested_by),
      'executive_id', r.executive_id,
      'executive', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.executive_id),
      'executive_active', (select u.status = 'ACTIVE' from users u where u.id = r.executive_id),
      'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
      'decider', case when r.decided_by is null then null when r.decided_by = any(hidden_user_ids()) then 'An administrator'
                 else (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.decided_by) end,
      'mine', r.requested_by = auth.uid(),
      'can_decide', r.status = 'PENDING' and r.requested_by <> auth.uid() and (r.executive_id = auth.uid() or v_sa) and auth_has_permission('bu_goals.approve_retirement'))
      order by (r.status = 'PENDING') desc, r.requested_at desc)
    from bu_goal_retirement_requests r join bu_goals g on g.id = r.bu_goal_id
   where (p_quarter is null or r.quarter_id = p_quarter) and (p_bu is null or r.business_unit_id = p_bu)
     and (not p_mine_to_decide or (r.status = 'PENDING' and (r.executive_id = auth.uid() or v_sa)))
     and (v_sa or r.executive_id = auth.uid() or auth_can_view_bu(r.business_unit_id))), '[]'::jsonb);
end $$;

select lock_down_function_grants();
