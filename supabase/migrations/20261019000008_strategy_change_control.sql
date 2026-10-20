-- Strategy change control (owner decision 5, 14 October 2026; ADR-064).
-- Before a quarter is activated its strategy is drafted freely. From activation it is a controlled BASELINE: wording changes, additions and
-- retirements are no longer made directly. One person REQUESTS, a different person APPROVES, and approval applies the change in the same
-- transaction. Every version of every item is kept (version 1 is the baseline at activation); items are RETIRED, never deleted, so goals that
-- point at them keep their meaning and history.

insert into permissions (code, description) values
  ('strategy.change.request', 'Request a change to the strategy of an active quarter'),
  ('strategy.change.approve', 'Approve or reject a strategy change request');
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('ADMIN','strategy.change.request'),('SUPER_ADMIN','strategy.change.request'),
  ('ADMIN','strategy.change.approve'),('SUPER_ADMIN','strategy.change.approve'),('EXECUTIVE','strategy.change.approve')
) as g(role_code, perm) join roles r on r.code = g.role_code join permissions p on p.code = g.perm;

alter table key_results     add column status text not null default 'ACTIVE' check (status in ('ACTIVE','RETIRED')), add column retired_at timestamptz;
alter table sub_key_results add column status text not null default 'ACTIVE' check (status in ('ACTIVE','RETIRED')), add column retired_at timestamptz;

-- ---------------------------------------------------------------- every version of every item
create table strategy_item_versions (
  id            uuid primary key default gen_random_uuid(),
  quarter_id    uuid not null references quarters(id) on delete restrict,
  item_type     text not null check (item_type in ('OBJECTIVE','KR','SUBKR')),
  item_id       uuid not null,
  version       int  not null,
  title         text not null,
  description   text,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','RETIRED')),
  change_request_id uuid,                                  -- null = the baseline recorded at activation
  recorded_at   timestamptz not null default app_now(),
  unique (item_type, item_id, version)
);
create index strategy_item_versions_quarter_idx on strategy_item_versions (quarter_id, item_type, item_id);
create trigger strategy_item_versions_immutable before update or delete on strategy_item_versions for each row execute function forbid_mutation();
alter table strategy_item_versions enable row level security;
grant select on strategy_item_versions to authenticated;
create policy read_all on strategy_item_versions for select to authenticated using (true);

-- Version 1 of everything, taken the moment a quarter becomes ACTIVE.
create or replace function record_strategy_baseline() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'ACTIVE' and old.status is distinct from 'ACTIVE' then
    insert into strategy_item_versions (quarter_id, item_type, item_id, version, title, description, status)
      select new.id, 'OBJECTIVE', o.id, 1, o.title, o.description, 'ACTIVE' from quarterly_objectives o where o.quarter_id = new.id
      union all select new.id, 'KR', k.id, 1, k.title, k.description, k.status from key_results k join quarterly_objectives o on o.id = k.objective_id where o.quarter_id = new.id
      union all select new.id, 'SUBKR', s.id, 1, s.title, s.description, s.status from sub_key_results s join key_results k on k.id = s.key_result_id
                join quarterly_objectives o on o.id = k.objective_id where o.quarter_id = new.id
      on conflict do nothing;
  end if;
  return new;
end $$;
create trigger quarters_record_baseline after update of status on quarters for each row execute function record_strategy_baseline();

-- Quarters that were already active when this control began get their baseline now.
insert into strategy_item_versions (quarter_id, item_type, item_id, version, title, description, status)
  select q.id, 'OBJECTIVE', o.id, 1, o.title, o.description, 'ACTIVE' from quarters q join quarterly_objectives o on o.quarter_id = q.id where q.status in ('ACTIVE','LOCKED')
  union all select q.id, 'KR', k.id, 1, k.title, k.description, k.status from quarters q join quarterly_objectives o on o.quarter_id = q.id join key_results k on k.objective_id = o.id where q.status in ('ACTIVE','LOCKED')
  union all select q.id, 'SUBKR', s.id, 1, s.title, s.description, s.status from quarters q join quarterly_objectives o on o.quarter_id = q.id join key_results k on k.objective_id = o.id join sub_key_results s on s.key_result_id = k.id where q.status in ('ACTIVE','LOCKED')
  on conflict do nothing;

-- ---------------------------------------------------------------- direct edits stop at activation
create or replace function assert_strategy_direct_edit(p_quarter_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from quarters where id = p_quarter_id and status = 'ACTIVE') then
    raise exception 'STRATEGY_CHANGE_REQUIRED' using detail = 'this quarter is active: ask for the change, and a different person must approve it';
  end if;
end $$;

create or replace function update_objective(p_actor uuid, p_id uuid, p_title text, p_description text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old quarterly_objectives;
begin
  perform require_permission(p_actor, 'strategy.objective.edit');
  select * into v_old from quarterly_objectives where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform assert_quarter_editable(v_old.quarter_id);
  perform assert_strategy_direct_edit(v_old.quarter_id);
  update quarterly_objectives set title = btrim(p_title), description = p_description, updated_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'OBJECTIVE_UPDATED', 'quarterly_objective', p_id::text,
    jsonb_build_object('title', v_old.title, 'description', v_old.description), jsonb_build_object('title', btrim(p_title), 'description', p_description));
end $$;

create or replace function update_key_result(p_actor uuid, p_id uuid, p_title text, p_description text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old key_results; v_q uuid;
begin
  perform require_permission(p_actor, 'strategy.kr.edit');
  select * into v_old from key_results where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select quarter_id into v_q from quarterly_objectives where id = v_old.objective_id;
  perform assert_quarter_editable(v_q);
  perform assert_strategy_direct_edit(v_q);
  update key_results set title = btrim(p_title), description = p_description, updated_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'KR_UPDATED', 'key_result', p_id::text,
    jsonb_build_object('title', v_old.title, 'description', v_old.description), jsonb_build_object('title', btrim(p_title), 'description', p_description));
end $$;

create or replace function update_sub_key_result(p_actor uuid, p_id uuid, p_title text, p_description text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old sub_key_results; v_q uuid;
begin
  perform require_permission(p_actor, 'strategy.subkr.edit');
  select * into v_old from sub_key_results where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select o.quarter_id into v_q from key_results k join quarterly_objectives o on o.id = k.objective_id where k.id = v_old.key_result_id;
  perform assert_quarter_editable(v_q);
  perform assert_strategy_direct_edit(v_q);
  update sub_key_results set title = btrim(p_title), description = p_description, updated_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'SUBKR_UPDATED', 'sub_key_result', p_id::text,
    jsonb_build_object('title', v_old.title, 'description', v_old.description), jsonb_build_object('title', btrim(p_title), 'description', p_description));
end $$;

create or replace function create_key_result(p_actor uuid, p_objective_id uuid, p_title text, p_description text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_q uuid; v_seq int; v_id uuid;
begin
  perform require_permission(p_actor, 'strategy.kr.create');
  select quarter_id into v_q from quarterly_objectives where id = p_objective_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform assert_quarter_editable(v_q);
  perform assert_strategy_direct_edit(v_q);
  select coalesce(max(sequence), 0) + 1 into v_seq from key_results where objective_id = p_objective_id;
  if v_seq > 4 then raise exception 'KR_LIMIT_EXCEEDED' using detail = 'A quarter may contain at most 4 key results'; end if;
  insert into key_results (objective_id, sequence, code, title, description) values (p_objective_id, v_seq, 'KR' || v_seq, btrim(p_title), p_description) returning id into v_id;
  perform write_audit(p_actor, 'KR_CREATED', 'key_result', v_id::text, null, jsonb_build_object('code', 'KR' || v_seq, 'title', btrim(p_title)));
  return v_id;
end $$;

create or replace function create_sub_key_result(p_actor uuid, p_kr_id uuid, p_title text, p_description text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_kr key_results; v_q uuid; v_seq int; v_id uuid;
begin
  perform require_permission(p_actor, 'strategy.subkr.create');
  select * into v_kr from key_results where id = p_kr_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select quarter_id into v_q from quarterly_objectives where id = v_kr.objective_id;
  perform assert_quarter_editable(v_q);
  perform assert_strategy_direct_edit(v_q);
  select coalesce(max(sequence), 0) + 1 into v_seq from sub_key_results where key_result_id = p_kr_id;
  insert into sub_key_results (key_result_id, sequence, code, title, description)
    values (p_kr_id, v_seq, v_kr.code || '.' || v_seq, btrim(p_title), p_description) returning id into v_id;
  perform write_audit(p_actor, 'SUBKR_CREATED', 'sub_key_result', v_id::text, null, jsonb_build_object('code', v_kr.code || '.' || v_seq, 'title', btrim(p_title)));
  return v_id;
end $$;

create or replace function read_strategy_tree(p_quarter_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  return (
    select jsonb_build_object(
      'quarter', to_jsonb(q),
      'objective', case when o.id is null then null else jsonb_build_object('id', o.id, 'title', o.title, 'description', o.description) end,
      'pending_changes', (select count(*) from strategy_change_requests c where c.quarter_id = q.id and c.status = 'PENDING'),
      'key_results', coalesce((
        select jsonb_agg(jsonb_build_object('id', k.id, 'code', k.code, 'title', k.title, 'description', k.description, 'status', k.status,
          'sub_key_results', coalesce((
            select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'title', s.title, 'description', s.description, 'status', s.status,
              'mapped_goals', m.total, 'done_goals', m.done,
              'execution', case when m.total = 0 then null else round(m.done * 100.0 / m.total, 2) end) order by s.sequence)
            from sub_key_results s
            left join lateral (
              select count(*)::int total, count(*) filter (where goal_is_done(g.id))::int done
              from smart_goals g join weekly_reports r on r.id = g.weekly_report_id
              where g.sub_key_result_id = s.id and g.deleted_at is null and r.status = 'FINAL_LOCKED' and r.submission_status = 'SUBMITTED') m on true
            where s.key_result_id = k.id), '[]'::jsonb)) order by k.sequence)
        from key_results k where k.objective_id = o.id), '[]'::jsonb),
      'readiness', case when q.status = 'PLANNED' then read_quarter_readiness(q.id) else '[]'::jsonb end)
    from quarters q left join quarterly_objectives o on o.quarter_id = q.id where q.id = p_quarter_id);
end $$;

create or replace function assert_subkr_valid_for_report(p_sub_kr_id uuid, p_report_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ok boolean;
begin
  if p_sub_kr_id is null then raise exception 'GOAL_SUB_KR_REQUIRED'; end if;
  select exists (
    select 1 from sub_key_results s join key_results k on k.id = s.key_result_id
    join quarterly_objectives o on o.id = k.objective_id
    join reporting_weeks w on w.quarter_id = o.quarter_id
    join weekly_reports r on r.reporting_week_id = w.id
    where s.id = p_sub_kr_id and r.id = p_report_id and s.status = 'ACTIVE') into v_ok;   -- a retired Sub-KR takes no new goals
  if not v_ok then raise exception 'GOAL_SUB_KR_INVALID' using detail = 'Sub-KR does not belong to this report''s quarter'; end if;
end $$;

-- ---------------------------------------------------------------- change requests
create table strategy_change_requests (
  id               uuid primary key default gen_random_uuid(),
  quarter_id       uuid not null references quarters(id) on delete restrict,
  change_type      text not null check (change_type in ('EDIT','RETIRE','ADD')),
  item_type        text not null check (item_type in ('OBJECTIVE','KR','SUBKR')),
  item_id          uuid,                                   -- the item changed (EDIT, RETIRE); null for ADD
  parent_id        uuid,                                   -- ADD: the objective (for a KR) or the KR (for a Sub-KR)
  new_title        text,
  new_description  text,
  reason           text not null check (btrim(reason) <> ''),
  status           text not null default 'PENDING' check (status in ('PENDING','APPLIED','REJECTED')),
  requested_by     uuid not null references users(id),
  idempotency_key  text not null unique,
  decided_by       uuid references users(id),
  decided_at       timestamptz,
  decision_comment text,
  decision_key     text unique,
  result_item_id   uuid,
  created_at       timestamptz not null default app_now(),
  check ((change_type = 'ADD') = (item_id is null)),
  check (change_type <> 'ADD' or parent_id is not null),
  check (change_type = 'RETIRE' or (new_title is not null and btrim(new_title) <> '')),
  check (change_type <> 'ADD' or item_type in ('KR','SUBKR')),
  check (change_type <> 'RETIRE' or item_type in ('KR','SUBKR')),
  check ((status = 'PENDING') = (decided_by is null)),
  check (decided_by is null or decided_by <> requested_by),
  check (status <> 'REJECTED' or (decision_comment is not null and btrim(decision_comment) <> '')),
  check (status <> 'APPLIED' or change_type = 'RETIRE' or result_item_id is not null)
);
create unique index strategy_change_one_pending_per_item on strategy_change_requests (item_type, item_id) where status = 'PENDING' and item_id is not null;
create index strategy_change_time_idx on strategy_change_requests (created_at desc);

create or replace function strategy_change_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'change requests are never deleted'; end if;
  if old.status <> 'PENDING' then raise exception 'IMMUTABLE_RECORD' using detail = 'a decided request cannot change'; end if;
  if new.quarter_id <> old.quarter_id or new.change_type <> old.change_type or new.item_type <> old.item_type or new.item_id is distinct from old.item_id
     or new.parent_id is distinct from old.parent_id or new.new_title is distinct from old.new_title or new.new_description is distinct from old.new_description
     or new.reason <> old.reason or new.requested_by <> old.requested_by or new.idempotency_key <> old.idempotency_key or new.created_at <> old.created_at then
    raise exception 'IMMUTABLE_RECORD' using detail = 'only the decision can be recorded';
  end if;
  return new;
end $$;
create trigger strategy_change_requests_guard before update or delete on strategy_change_requests for each row execute function strategy_change_guard();

create or replace function strategy_item_quarter(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_type
    when 'OBJECTIVE' then (select quarter_id from quarterly_objectives where id = p_id)
    when 'KR' then (select o.quarter_id from key_results k join quarterly_objectives o on o.id = k.objective_id where k.id = p_id)
    else (select o.quarter_id from sub_key_results s join key_results k on k.id = s.key_result_id join quarterly_objectives o on o.id = k.objective_id where s.id = p_id) end;
$$;

create or replace function request_strategy_change(
  p_actor uuid, p_change text, p_item_type text, p_item_id uuid, p_parent_id uuid, p_title text, p_description text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ex strategy_change_requests; v_q uuid; v_id uuid; v_title text := nullif(btrim(coalesce(p_title, '')), ''); v_status text; v_n int;
begin
  perform require_permission(p_actor, 'strategy.change.request');
  if p_change not in ('EDIT','RETIRE','ADD') or p_item_type not in ('OBJECTIVE','KR','SUBKR') then raise exception 'VALIDATION_ERROR' using detail = 'unknown change or item type'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_ex from strategy_change_requests where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.requested_by <> p_actor or v_ex.change_type <> p_change or v_ex.item_type <> p_item_type or v_ex.item_id is distinct from p_item_id then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_ex.id, 'status', v_ex.status);
  end if;
  if p_change <> 'RETIRE' and v_title is null then raise exception 'VALIDATION_ERROR' using detail = 'a title is required'; end if;
  if p_change = 'ADD' then
    if p_item_type = 'OBJECTIVE' or p_item_id is not null or p_parent_id is null then raise exception 'VALIDATION_ERROR' using detail = 'add a key result under the objective, or a Sub-KR under a key result'; end if;
    v_q := case p_item_type when 'KR' then (select quarter_id from quarterly_objectives where id = p_parent_id)
                            else (select o.quarter_id from key_results k join quarterly_objectives o on o.id = k.objective_id where k.id = p_parent_id) end;
  else
    if p_item_id is null then raise exception 'VALIDATION_ERROR' using detail = 'choose the item'; end if;
    if p_change = 'RETIRE' and p_item_type = 'OBJECTIVE' then raise exception 'VALIDATION_ERROR' using detail = 'a quarter keeps its objective; retire a key result or Sub-KR instead'; end if;
    v_q := strategy_item_quarter(p_item_type, p_item_id);
  end if;
  if v_q is null then raise exception 'NOT_FOUND'; end if;
  if p_change = 'ADD' and p_item_type = 'SUBKR' and (select status from key_results where id = p_parent_id) = 'RETIRED' then raise exception 'STRATEGY_ITEM_RETIRED'; end if;
  select status into v_status from quarters where id = v_q;
  if v_status <> 'ACTIVE' then
    if v_status = 'LOCKED' then raise exception 'QUARTER_LOCKED'; end if;
    raise exception 'STRATEGY_CHANGE_NOT_NEEDED' using detail = 'this quarter is still in draft: edit it directly';
  end if;
  if p_change in ('EDIT','RETIRE') then
    if p_item_type = 'KR' and (select status from key_results where id = p_item_id) = 'RETIRED' then raise exception 'STRATEGY_ITEM_RETIRED'; end if;
    if p_item_type = 'SUBKR' and (select status from sub_key_results where id = p_item_id) = 'RETIRED' then raise exception 'STRATEGY_ITEM_RETIRED'; end if;
  end if;
  if p_change = 'RETIRE' then                                   -- the quarter must stay complete: 3 to 4 key results, each with a Sub-KR
    if p_item_type = 'KR' then
      select count(*) into v_n from key_results where objective_id = (select objective_id from key_results where id = p_item_id) and status = 'ACTIVE' and id <> p_item_id;
      if v_n < 3 then raise exception 'STRATEGY_BELOW_MINIMUM' using detail = 'a quarter needs at least 3 active key results'; end if;
    else
      select count(*) into v_n from sub_key_results where key_result_id = (select key_result_id from sub_key_results where id = p_item_id) and status = 'ACTIVE' and id <> p_item_id;
      if v_n < 1 then raise exception 'STRATEGY_BELOW_MINIMUM' using detail = 'a key result needs at least one active Sub-KR'; end if;
    end if;
  end if;
  if p_change = 'ADD' and p_item_type = 'KR' and (select count(*) from key_results where objective_id = p_parent_id) >= 4 then
    raise exception 'KR_LIMIT_EXCEEDED' using detail = 'a quarter holds at most 4 key results, retired ones included';
  end if;
  if p_change <> 'ADD' and exists (select 1 from strategy_change_requests where item_type = p_item_type and item_id = p_item_id and status = 'PENDING') then raise exception 'STRATEGY_CHANGE_PENDING'; end if;
  insert into strategy_change_requests (quarter_id, change_type, item_type, item_id, parent_id, new_title, new_description, reason, requested_by, idempotency_key)
    values (v_q, p_change, p_item_type, p_item_id, p_parent_id, v_title, nullif(btrim(coalesce(p_description, '')), ''), btrim(p_reason), p_actor, p_idempotency_key) returning id into v_id;
  perform write_audit(p_actor, 'STRATEGY_CHANGE_REQUESTED', 'strategy_change_request', v_id::text, null, jsonb_build_object('change', p_change, 'item_type', p_item_type, 'item_id', p_item_id, 'title', v_title), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission('strategy.change.approve'), p_actor), 'STRATEGY_CHANGE_REQUESTED', 'strategy_change_request', v_id::text,
    'A strategy change needs your decision', 'A change to the active quarter was requested (' || lower(p_change) || ' ' || lower(p_item_type) || '). Reason given: ' || btrim(p_reason), 'strat-req:' || v_id);
  return jsonb_build_object('replayed', false, 'request_id', v_id, 'status', 'PENDING');
end $$;

-- Approval applies the change in the same transaction and records the new version.
create or replace function decide_strategy_change(p_actor uuid, p_request_id uuid, p_decision text, p_comment text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r strategy_change_requests; v_prev strategy_change_requests; v_item uuid; v_ver int; v_title text; v_desc text; v_seq int; v_code text; v_kr key_results; v_status text := 'ACTIVE';
begin
  perform require_permission(p_actor, 'strategy.change.approve');
  if p_decision is null or p_decision not in ('APPROVE','REJECT') then raise exception 'VALIDATION_ERROR' using detail = 'decision must be APPROVE or REJECT'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_prev from strategy_change_requests where decision_key = p_idempotency_key;
  if found then
    if v_prev.id <> p_request_id or v_prev.decided_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_prev.id, 'status', v_prev.status, 'item_id', coalesce(v_prev.result_item_id, v_prev.item_id));
  end if;
  select * into r from strategy_change_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'STRATEGY_CHANGE_NOT_PENDING'; end if;
  if r.requested_by = p_actor then raise exception 'STRATEGY_CHANGE_SELF_APPROVAL'; end if;
  if p_decision = 'REJECT' then
    if p_comment is null or btrim(p_comment) = '' then raise exception 'REASON_REQUIRED'; end if;
    update strategy_change_requests set status = 'REJECTED', decided_by = p_actor, decided_at = app_now(), decision_comment = btrim(p_comment), decision_key = p_idempotency_key where id = r.id;
    perform write_audit(p_actor, 'STRATEGY_CHANGE_REJECTED', 'strategy_change_request', r.id::text, jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'REJECTED'), btrim(p_comment));
    perform notify_users(array[r.requested_by], 'STRATEGY_CHANGE_DECIDED', 'strategy_change_request', r.id::text, 'Your strategy change was rejected', 'Reason: ' || btrim(p_comment), 'strat-dec:' || r.id);
    return jsonb_build_object('replayed', false, 'request_id', r.id, 'status', 'REJECTED');
  end if;

  if (select status from quarters where id = r.quarter_id) <> 'ACTIVE' then raise exception 'QUARTER_LOCKED' using detail = 'the quarter is no longer active'; end if;
  if r.change_type = 'ADD' and r.item_type = 'KR' then
    select coalesce(max(sequence), 0) + 1 into v_seq from key_results where objective_id = r.parent_id;
    if v_seq > 4 then raise exception 'KR_LIMIT_EXCEEDED'; end if;
    insert into key_results (objective_id, sequence, code, title, description) values (r.parent_id, v_seq, 'KR' || v_seq, r.new_title, r.new_description) returning id into v_item;
    v_title := r.new_title; v_desc := r.new_description;
  elsif r.change_type = 'ADD' then
    select * into v_kr from key_results where id = r.parent_id for update;
    if v_kr.status = 'RETIRED' then raise exception 'STRATEGY_ITEM_RETIRED'; end if;
    select coalesce(max(sequence), 0) + 1 into v_seq from sub_key_results where key_result_id = r.parent_id;
    v_code := v_kr.code || '.' || v_seq;
    insert into sub_key_results (key_result_id, sequence, code, title, description) values (r.parent_id, v_seq, v_code, r.new_title, r.new_description) returning id into v_item;
    v_title := r.new_title; v_desc := r.new_description;
  elsif r.change_type = 'EDIT' then
    v_item := r.item_id;
    if r.item_type = 'OBJECTIVE' then update quarterly_objectives set title = r.new_title, description = r.new_description, updated_at = app_now() where id = v_item;
    elsif r.item_type = 'KR' then update key_results set title = r.new_title, description = r.new_description, updated_at = app_now() where id = v_item and status = 'ACTIVE';
    else update sub_key_results set title = r.new_title, description = r.new_description, updated_at = app_now() where id = v_item and status = 'ACTIVE'; end if;
    if not found then raise exception 'STRATEGY_ITEM_RETIRED'; end if;
    v_title := r.new_title; v_desc := r.new_description;
  else
    v_item := r.item_id; v_status := 'RETIRED';
    if r.item_type = 'KR' then update key_results set status = 'RETIRED', retired_at = app_now(), updated_at = app_now() where id = v_item and status = 'ACTIVE' returning title, description into v_title, v_desc;
    else update sub_key_results set status = 'RETIRED', retired_at = app_now(), updated_at = app_now() where id = v_item and status = 'ACTIVE' returning title, description into v_title, v_desc; end if;
    if not found then raise exception 'STRATEGY_ITEM_RETIRED'; end if;
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from strategy_item_versions where item_type = r.item_type and item_id = v_item;
  insert into strategy_item_versions (quarter_id, item_type, item_id, version, title, description, status, change_request_id) values (r.quarter_id, r.item_type, v_item, v_ver, v_title, v_desc, v_status, r.id);
  update strategy_change_requests set status = 'APPLIED', decided_by = p_actor, decided_at = app_now(), decision_comment = nullif(btrim(coalesce(p_comment, '')), ''), decision_key = p_idempotency_key,
    result_item_id = case when r.change_type = 'RETIRE' then null else v_item end where id = r.id;
  perform write_audit(p_actor, 'STRATEGY_CHANGE_APPLIED', 'strategy_change_request', r.id::text, jsonb_build_object('status', 'PENDING'),
    jsonb_build_object('status', 'APPLIED', 'change', r.change_type, 'item_type', r.item_type, 'item_id', v_item, 'version', v_ver, 'requested_by', r.requested_by), nullif(btrim(coalesce(p_comment, '')), ''));
  perform notify_users(array[r.requested_by], 'STRATEGY_CHANGE_DECIDED', 'strategy_change_request', r.id::text, 'Your strategy change was approved and applied', 'The strategy now reads as you asked. Earlier versions are kept.', 'strat-dec:' || r.id);
  return jsonb_build_object('replayed', false, 'request_id', r.id, 'status', 'APPLIED', 'item_id', v_item, 'version', v_ver);
end $$;

-- ---------------------------------------------------------------- read models + RLS
create or replace function read_strategy_changes(p_quarter_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'status', c.status, 'change_type', c.change_type, 'item_type', c.item_type, 'item_id', c.item_id, 'parent_id', c.parent_id,
    'new_title', c.new_title, 'new_description', c.new_description, 'reason', c.reason, 'created_at', c.created_at, 'decided_at', c.decided_at,
    'decision_comment', c.decision_comment, 'requested_by_id', c.requested_by,
    'current_title', case c.item_type when 'OBJECTIVE' then (select title from quarterly_objectives where id = c.item_id) when 'KR' then (select title from key_results where id = c.item_id)
                      else (select title from sub_key_results where id = c.item_id) end,
    'requested_by', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = c.requested_by),
    'decided_by', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = c.decided_by)
  ) order by c.created_at desc), '[]'::jsonb)
  from strategy_change_requests c where c.quarter_id = p_quarter_id;
$$;

create or replace function read_strategy_history(p_quarter_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_type', v.item_type, 'item_id', v.item_id, 'version', v.version, 'title', v.title, 'description', v.description,
    'status', v.status, 'recorded_at', v.recorded_at, 'baseline', v.change_request_id is null) order by v.item_type, v.item_id, v.version), '[]'::jsonb)
  from strategy_item_versions v where v.quarter_id = p_quarter_id;
$$;

alter table strategy_change_requests enable row level security;
grant select on strategy_change_requests to authenticated;
create policy read_scoped on strategy_change_requests for select to authenticated using (auth_has_any(array['strategy.change.request','strategy.change.approve','strategy.objective.edit']));

select lock_down_function_grants();
