-- Business Unit goals (owner rule, 25 November 2026): the goals are set at the start of the quarter and locked by the Admin or Super Admin. Once locked, NO ONE
-- edits them directly. A change (add, rename, retire, restore) is asked for, goes to the executive the BU Lead chooses, and nothing is updated until that
-- executive approves. Retiring already worked this way (ADR-134); this brings add, rename and restore to the same rule and closes two gaps:
--   * the people who hold the lock permission (Admin, Super Admin) could still edit a locked goal directly: they cannot any more;
--   * Admin and HR could approve change requests: only the chosen Executive (and the Super Admin, ADR-112) can.
-- Lifting a lock stays an Admin or Super Admin act with a recorded reason (unlock_bu_goals): it is how a mistake in the lock itself is put right.

-- 1. nobody edits a locked goal directly: the lock holders lose their exemption (approvals still apply their change through the flag set inside decide_bu_goal_change)
do $$
declare v_def text; v_new text;
  a text := $a$ and not actor_has_permission(p_actor, 'bu_goals.lock') then raise exception 'BU_GOALS_LOCKED' using detail = 'these goals are locked: send a change request and an Executive, Admin or HR will approve it'; end if;$a$;
  b text := $b$ then raise exception 'BU_GOALS_LOCKED' using detail = 'these goals are locked: ask for the change and the executive you choose decides it'; end if;$b$;
begin
  v_def := pg_get_functiondef('save_bu_goal(uuid,uuid,uuid,uuid,text,text)'::regprocedure);
  if position(b in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'save_bu_goal: the lock exemption was not found'; end if;
  v_new := replace(v_def, a, b);
  execute v_new;
end $$;

-- 2. a change request names the executive who decides it
alter table bu_goal_change_requests add column if not exists executive_id uuid references users(id);

-- the old seven-argument version is replaced: a request now carries the executive's id (retirement has its own request and is refused here)
drop function if exists request_bu_goal_change(uuid, uuid, uuid, text, uuid, text, text);

create or replace function request_bu_goal_change(p_actor uuid, p_bu uuid, p_quarter uuid, p_kind text, p_goal uuid, p_title text, p_reason text, p_executive uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bu uuid := coalesce(p_bu, actor_bu(p_actor)); v_title text := nullif(btrim(coalesce(p_title, '')), ''); v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); g bu_goals; v_id uuid;
begin
  perform require_permission(p_actor, 'bu_goals.manage');
  if not actor_may_file_for(p_actor, v_bu) then raise exception 'BU_SCOPE_DENIED'; end if;
  if p_kind not in ('ADD', 'RENAME', 'RESTORE') then
    raise exception 'VALIDATION_ERROR' using detail = case when p_kind = 'RETIRE' then 'a goal is retired through the executive retirement request: choose Retire on the goal' else 'kind must be ADD, RENAME or RESTORE' end;
  end if;
  if v_reason is null or char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'a reason of up to 2000 characters is required'; end if;
  if not bu_goals_locked(v_bu, p_quarter) then raise exception 'VALIDATION_ERROR' using detail = 'the goals are not locked: change them directly'; end if;
  if p_kind in ('ADD', 'RENAME') and (v_title is null or char_length(v_title) > 500) then raise exception 'VALIDATION_ERROR' using detail = 'a goal needs a title of up to 500 characters'; end if;
  if p_executive is null or p_executive = p_actor or not exists (select 1 from bu_goal_retirement_executives(p_actor) x where x.id = p_executive) then
    raise exception 'VALIDATION_ERROR' using detail = 'choose an executive from the list';
  end if;
  if p_kind = 'ADD' then p_goal := null; else
    select * into g from bu_goals where id = p_goal;
    if not found or g.business_unit_id <> v_bu or g.quarter_id <> p_quarter then raise exception 'NOT_FOUND' using detail = 'goal'; end if;
    if p_kind = 'RESTORE' and g.status = 'ACTIVE' then raise exception 'VALIDATION_ERROR' using detail = 'that goal is already active'; end if;
  end if;
  insert into bu_goal_change_requests (business_unit_id, quarter_id, kind, bu_goal_id, title, reason, requested_by, executive_id)
    values (v_bu, p_quarter, p_kind, p_goal, case when p_kind in ('ADD', 'RENAME') then v_title else null end, v_reason, p_actor, p_executive) returning id into v_id;
  perform write_audit(p_actor, 'BU_GOAL_CHANGE_REQUESTED', 'bu_goal_change_request', v_id::text, case when p_goal is null then null else jsonb_build_object('title', g.title, 'status', g.status) end,
    jsonb_build_object('kind', p_kind, 'title', v_title, 'executive_id', p_executive), v_reason, v_bu);
  perform notify_users(array[p_executive], 'BU_GOAL_CHANGE_REQUESTED', 'bu_goal_change_request', v_id::text,
    'Business Unit goal change requested', 'A unit has asked to change a locked goal and chose you to decide it. Nothing changes unless you approve.', 'bug-req:' || v_id);
  return v_id;
end $$;

-- 3. only the executive named on the request decides it (the Super Admin may also, ADR-112); a request made before this rule, with no executive named, is decided by the Super Admin
do $$
declare v_def text; v_new text;
  a text := $a$if r.requested_by = p_actor then raise exception 'BU_GOAL_CHANGE_SELF_APPROVAL'; end if;$a$;
  b text := $b$if r.requested_by = p_actor then raise exception 'BU_GOAL_CHANGE_SELF_APPROVAL'; end if;
  if r.executive_id is distinct from p_actor and not is_super_admin(p_actor) then raise exception 'PERMISSION_DENIED' using detail = 'only the executive chosen for this request can decide it'; end if;$b$;
begin
  v_def := pg_get_functiondef('decide_bu_goal_change(uuid,uuid,boolean,text)'::regprocedure);
  if position('only the executive chosen for this request' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'decide_bu_goal_change: the self-approval line was not found'; end if;
  execute replace(v_def, a, b);
end $$;

-- 4. Admin and HR no longer approve changes; the Executive (and the Super Admin) do
delete from role_permissions where role_id in (select id from roles where code in ('ADMIN', 'HR')) and permission_id in (select id from permissions where code = 'bu_goals.approve_change');
update permissions set description = 'Approve or reject a change to a locked Business Unit goal that a BU Lead sent to you by name (Executive; Super Admin)' where code = 'bu_goals.approve_change';

-- 5. the screen is told which executive was chosen and whether the viewer may decide
do $$
declare v_def text; v_new text;
  a text := $a$'mine', r.requested_by = auth.uid())$a$;
  b text := $b$'executive_id', r.executive_id, 'executive', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.executive_id),
      'can_decide', (r.status = 'PENDING' and r.requested_by <> auth.uid() and (r.executive_id = auth.uid() or is_super_admin(auth.uid()))),
      'mine', r.requested_by = auth.uid())$b$;
begin
  v_def := pg_get_functiondef('read_bu_goal_change_requests(uuid,uuid)'::regprocedure);
  if position('can_decide' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'read_bu_goal_change_requests: the mine line was not found'; end if;
  execute replace(v_def, a, b);
end $$;

select lock_down_function_grants();
