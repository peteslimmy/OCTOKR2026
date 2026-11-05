-- Import rollback, steps 2 and 3 (ADR-087 / ADR-088): strategy, sign-in and historical imports can be voided by a Super Admin inside the 72-hour window.
-- The rule is the same as step 1: nothing is lost. Every record removed is archived first (strategy) or reconstructable from the committed batch (history),
-- a permanent rollback record and an audit entry are written, and the void is refused, with the reasons listed, if anything has been built on the imported data.
-- All removals run under one narrow, transaction-local flag (app.import_void) that only these functions set, in the same way as app.session_correction.

-- ================================================================== common
create table import_rollbacks (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('STRATEGY','SIGN_INS','HISTORY')),
  batch_id   uuid not null,
  voided_by  uuid not null references users(id),
  reason     text not null check (char_length(btrim(reason)) between 10 and 2000),
  voided_at  timestamptz not null default app_now(),
  undone     jsonb not null
);
create index import_rollbacks_batch_idx on import_rollbacks (kind, batch_id);
create trigger import_rollbacks_immutable before update or delete on import_rollbacks for each row execute function forbid_mutation();
alter table import_rollbacks enable row level security;
grant select on import_rollbacks to authenticated;
create policy read_importers on import_rollbacks for select to authenticated
  using ((select auth_has_permission('users.manage')) or (select auth_has_permission('strategy.import')) or (select auth_has_permission('history.import')));

-- who may void, the typed confirmation and the reason; returns the trimmed reason
create or replace function import_void_gate(p_actor uuid, p_reason text, p_confirm text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not is_super_admin(p_actor) then raise exception 'PERMISSION_DENIED' using detail = 'only a Super Admin may void an import'; end if;
  if p_confirm is distinct from 'VOID IMPORT' then raise exception 'VALIDATION_ERROR' using detail = 'type VOID IMPORT to confirm'; end if;
  if v_reason is null or char_length(v_reason) < 10 then raise exception 'REASON_REQUIRED' using detail = 'give a reason of at least 10 characters'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  return v_reason;
end $$;

-- Tables that point at the given rows (single-column foreign keys), other than the ones the void is allowed to remove: each is a reason to refuse.
create or replace function import_void_children(p_parent regclass, p_ids uuid[], p_purge text[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; n bigint; v jsonb := '[]'::jsonb;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return v; end if;
  for c in select k.conrelid::regclass::text as child, a.attname::text as col from pg_constraint k
             join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
            where k.contype = 'f' and k.confrelid = p_parent and cardinality(k.conkey) = 1 loop
    if c.child = any(p_purge) then continue; end if;
    execute format('select count(*) from %s where %I = any($1)', c.child, c.col) into n using p_ids;
    if n > 0 then v := v || jsonb_build_object('why', n || ' row(s) in ' || c.child || ' now depend on the imported records'); end if;
  end loop;
  return v;
end $$;

-- removes the rows of the named child tables that point at the given rows
create or replace function import_void_purge(p_parent regclass, p_ids uuid[], p_tables text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  for c in select k.conrelid::regclass::text as child, a.attname::text as col from pg_constraint k
             join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
            where k.contype = 'f' and k.confrelid = p_parent and cardinality(k.conkey) = 1 loop
    if c.child = any(p_tables) then execute format('delete from %s where %I = any($1)', c.child, c.col) using p_ids; end if;
  end loop;
end $$;

-- ================================================================== the flag: deletes are allowed only while a void function has set it
do $$
declare v_def text; fn text; t text; n int;
begin
  foreach fn in array array['guard_strategy_row()','guard_reporting_week()','guard_task()','guard_weekly_report()'] loop
    v_def := pg_get_functiondef(fn::regprocedure);
    t := 'if tg_op = ''DELETE'' then';
    n := (length(v_def) - length(replace(v_def, t, ''))) / length(t);
    if n <> 1 then raise exception '%: expected text found % times', fn, n; end if;
    execute replace(v_def, t, 'if tg_op = ''DELETE'' and coalesce(current_setting(''app.import_void'', true), '''') = ''on'' then return old; end if; ' || t);
  end loop;
  v_def := pg_get_functiondef('forbid_mutation()'::regprocedure);
  t := 'if tg_op = ''UPDATE'' then';
  n := (length(v_def) - length(replace(v_def, t, ''))) / length(t);
  if n <> 1 then raise exception 'forbid_mutation: expected text found % times', n; end if;
  execute replace(v_def, t, 'if tg_op = ''DELETE'' and coalesce(current_setting(''app.import_void'', true), '''') = ''on'' then return old; end if; ' || t);
end $$;

-- ================================================================== strategy import
create table strategy_import_archive (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references strategy_import_batches(id) on delete restrict,
  item_type   text not null check (item_type in ('QUARTER','OBJECTIVE','KR','SUBKR')),
  item_id     uuid not null,
  row_data    jsonb not null,
  archived_at timestamptz not null default app_now()
);
create trigger strategy_import_archive_immutable before update or delete on strategy_import_archive for each row execute function forbid_mutation();
alter table strategy_import_archive enable row level security;       -- no grant: only the void function reads or writes it

create or replace function strategy_void(p_actor uuid, p_batch uuid, p_reason text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text := import_void_gate(p_actor, p_reason, p_confirm);
  b strategy_import_batches; v_prev import_rollbacks; v_org uuid; el jsonb; q quarters; o quarterly_objectives; v_blockers jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb; v_kr int := 0; v_sk int := 0; v_obj int := 0; v_qdel int := 0; v_qrestored int := 0; v_undone jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('import-void:' || p_batch::text, 0));
  select * into b from strategy_import_batches where id = p_batch;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_prev from import_rollbacks where kind = 'STRATEGY' and batch_id = p_batch;
  if found then return v_prev.undone || jsonb_build_object('replayed', true); end if;
  if app_now() > b.created_at + import_void_window() then
    raise exception 'IMPORT_VOID_WINDOW_CLOSED' using detail = 'the rollback window ended ' || to_char(b.created_at + import_void_window(), 'YYYY-MM-DD HH24:MI') || '; change the strategy through a change request';
  end if;
  select id into v_org from organisations limit 1;

  -- 1. what this import wrote must still be exactly what it wrote, and nothing may depend on it
  for el in select * from jsonb_array_elements(b.result->'quarters') loop
    select * into q from quarters where organisation_id = v_org and year = (el->>'year')::int and quarter_number = (el->>'quarter')::int;
    if not found then v_blockers := v_blockers || jsonb_build_object('why', el->>'year' || ' Q' || (el->>'quarter') || ' no longer exists'); continue; end if;
    if q.status <> el->>'status' then v_blockers := v_blockers || jsonb_build_object('why', q.year || ' Q' || q.quarter_number || ' is now ' || q.status || ', so its strategy is no longer the imported baseline'); continue; end if;
    select * into o from quarterly_objectives where quarter_id = q.id;
    if not found or o.created_at <> b.created_at then v_blockers := v_blockers || jsonb_build_object('why', q.year || ' Q' || q.quarter_number || ' does not hold this import''s objective'); continue; end if;
    if o.updated_at > b.created_at or exists (select 1 from key_results k where k.objective_id = o.id and k.updated_at > b.created_at)
       or exists (select 1 from sub_key_results s join key_results k on k.id = s.key_result_id where k.objective_id = o.id and s.updated_at > b.created_at) then
      v_blockers := v_blockers || jsonb_build_object('why', q.year || ' Q' || q.quarter_number || ' strategy was edited after the import');
    end if;
    if exists (select 1 from smart_goals g join sub_key_results s on s.id = g.sub_key_result_id join key_results k on k.id = s.key_result_id where k.objective_id = o.id) then
      v_blockers := v_blockers || jsonb_build_object('why', q.year || ' Q' || q.quarter_number || ' has weekly goals tagged to its Sub-KRs');
    end if;
    if q.created_at = b.created_at then
      v_blockers := v_blockers || import_void_children('quarters'::regclass, array[q.id], array['quarterly_objectives']);
    end if;
  end loop;
  if jsonb_array_length(v_blockers) > 0 then
    raise exception 'IMPORT_VOID_BLOCKED' using detail = (select jsonb_agg(x) from (select x from jsonb_array_elements(v_blockers) x limit 50) s)::text;
  end if;

  -- 2. archive, then remove: Sub-KRs, key results, the objective, and the quarter itself when this import created it
  begin
    perform set_config('app.import_void', 'on', true);
    for el in select * from jsonb_array_elements(b.result->'quarters') loop
      select * into q from quarters where organisation_id = v_org and year = (el->>'year')::int and quarter_number = (el->>'quarter')::int;
      select * into o from quarterly_objectives where quarter_id = q.id;
      insert into strategy_import_archive (batch_id, item_type, item_id, row_data) select p_batch, 'SUBKR', s.id, to_jsonb(s) from sub_key_results s join key_results k on k.id = s.key_result_id where k.objective_id = o.id;
      insert into strategy_import_archive (batch_id, item_type, item_id, row_data) select p_batch, 'KR', k.id, to_jsonb(k) from key_results k where k.objective_id = o.id;
      insert into strategy_import_archive (batch_id, item_type, item_id, row_data) values (p_batch, 'OBJECTIVE', o.id, to_jsonb(o));
      insert into strategy_import_archive (batch_id, item_type, item_id, row_data) values (p_batch, 'QUARTER', q.id, to_jsonb(q));
      delete from sub_key_results s using key_results k where k.id = s.key_result_id and k.objective_id = o.id; get diagnostics v_sk = row_count;
      delete from key_results where objective_id = o.id;
      delete from quarterly_objectives where id = o.id; v_obj := v_obj + 1;
      if q.created_at = b.created_at then
        delete from quarters where id = q.id; v_qdel := v_qdel + 1;
      elsif q.locked_at = b.created_at then
        update quarters set status = 'PLANNED', activated_at = null, locked_at = null where id = q.id; v_qrestored := v_qrestored + 1;
      end if;
      v_items := v_items || jsonb_build_object('year', q.year, 'quarter', q.quarter_number, 'sub_key_results', v_sk);
    end loop;
    perform set_config('app.import_void', 'off', true);
  exception when foreign_key_violation then
    perform set_config('app.import_void', 'off', true);
    raise exception 'IMPORT_VOID_BLOCKED' using detail = jsonb_build_array(jsonb_build_object('why', 'other records now depend on this strategy: ' || sqlerrm))::text;
  end;

  v_undone := jsonb_build_object('batchId', p_batch, 'kind', 'STRATEGY', 'objectives_removed', v_obj, 'quarters_removed', v_qdel, 'quarters_restored_to_planned', v_qrestored, 'quarters', v_items, 'replayed', false);
  insert into import_rollbacks (kind, batch_id, voided_by, reason, undone) values ('STRATEGY', p_batch, p_actor, v_reason, v_undone);
  perform write_audit(p_actor, 'STRATEGY_IMPORT_VOIDED', 'organisation', v_org::text, null, v_undone, v_reason, null);
  perform notify_users(users_with_permission('config.approve'), 'IMPORT_VOIDED', 'strategy_import', p_batch::text, 'A strategy import was voided',
    'A Super Admin rolled back the strategy import of ' || b.file_name || '. The quarters can be imported again.', 'import-void:' || p_batch);
  return v_undone;
end $$;

-- ================================================================== sign-in import
-- Until now a sign-in import left no record of its own (each person is created through the Add user function). It now records who it created.
create table sign_in_import_batches (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default app_now(),
  user_count int not null
);
create table sign_in_import_users (
  batch_id uuid not null references sign_in_import_batches(id) on delete restrict,
  user_id  uuid not null,                        -- no foreign key: voiding removes the account, this line stays as the record
  email    text not null,
  roles    text[] not null,
  primary key (batch_id, user_id)
);
create trigger sign_in_import_batches_immutable before update or delete on sign_in_import_batches for each row execute function forbid_mutation();
create trigger sign_in_import_users_immutable before update or delete on sign_in_import_users for each row execute function forbid_mutation();
alter table sign_in_import_batches enable row level security;
alter table sign_in_import_users enable row level security;           -- read only through read_rollbackable_imports()

create or replace function record_sign_in_import(p_actor uuid, p_users jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_n int;
begin
  perform require_permission(p_actor, 'users.manage');
  if p_users is null or jsonb_typeof(p_users) <> 'array' or jsonb_array_length(p_users) = 0 then raise exception 'VALIDATION_ERROR' using detail = 'no people to record'; end if;
  v_n := jsonb_array_length(p_users);
  insert into sign_in_import_batches (created_by, user_count) values (p_actor, v_n) returning id into v_id;
  insert into sign_in_import_users (batch_id, user_id, email, roles)
    select v_id, (x->>'userId')::uuid, lower(x->>'email'), array(select jsonb_array_elements_text(x->'roles') order by 1) from jsonb_array_elements(p_users) x;
  perform write_audit(p_actor, 'SIGN_IN_IMPORT_COMMITTED', 'sign_in_import', v_id::text, null, jsonb_build_object('created', v_n));
  return v_id;
end $$;

-- step 1 of a sign-in void (read-only): checks everything and returns the accounts to remove. The API removes them (the sign-in identities need the service role), then calls finish.
create or replace function sign_in_import_void_prepare(p_actor uuid, p_batch uuid, p_reason text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text := import_void_gate(p_actor, p_reason, p_confirm);
  b sign_in_import_batches; r record; v_blockers jsonb := '[]'::jsonb; v_ids uuid[] := '{}'; v_prev import_rollbacks;
begin
  select * into b from sign_in_import_batches where id = p_batch;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_prev from import_rollbacks where kind = 'SIGN_INS' and batch_id = p_batch;
  if found then return v_prev.undone || jsonb_build_object('replayed', true); end if;
  if app_now() > b.created_at + import_void_window() then
    raise exception 'IMPORT_VOID_WINDOW_CLOSED' using detail = 'the rollback window ended ' || to_char(b.created_at + import_void_window(), 'YYYY-MM-DD HH24:MI') || '; remove or suspend accounts from the Users screen';
  end if;
  for r in select * from sign_in_import_users where batch_id = p_batch order by email loop
    if not exists (select 1 from users where id = r.user_id) then continue; end if;                                    -- already gone
    if exists (select 1 from auth.users a where a.id = r.user_id and a.last_sign_in_at is not null) then
      v_blockers := v_blockers || jsonb_build_object('item', r.email, 'why', 'this person has already signed in');
    elsif exists (select 1 from audit_logs where actor_user_id = r.user_id) then
      v_blockers := v_blockers || jsonb_build_object('item', r.email, 'why', 'this person has already acted in the application');
    elsif (select array_agg(c order by c) from unnest(actor_role_codes(r.user_id)) c) is distinct from r.roles then
      v_blockers := v_blockers || jsonb_build_object('item', r.email, 'why', 'their roles were changed after the import');
    else
      v_ids := v_ids || r.user_id;
    end if;
  end loop;
  if jsonb_array_length(v_blockers) > 0 then
    raise exception 'IMPORT_VOID_BLOCKED' using detail = (select jsonb_agg(x) from (select x from jsonb_array_elements(v_blockers) x limit 50) s)::text;
  end if;
  return jsonb_build_object('batchId', p_batch, 'userIds', to_jsonb(v_ids), 'reason', v_reason);
end $$;

create or replace function sign_in_import_void_finish(p_actor uuid, p_batch uuid, p_reason text, p_confirm text, p_removed int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reason text := import_void_gate(p_actor, p_reason, p_confirm); v_prev import_rollbacks; v_undone jsonb;
begin
  if not exists (select 1 from sign_in_import_batches where id = p_batch) then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('import-void:' || p_batch::text, 0));
  select * into v_prev from import_rollbacks where kind = 'SIGN_INS' and batch_id = p_batch;
  if found then return v_prev.undone || jsonb_build_object('replayed', true); end if;
  if exists (select 1 from sign_in_import_users s join users u on u.id = s.user_id where s.batch_id = p_batch) then
    raise exception 'IMPORT_VOID_BLOCKED' using detail = jsonb_build_array(jsonb_build_object('why', 'some accounts are still present; run the rollback again'))::text;
  end if;
  v_undone := jsonb_build_object('batchId', p_batch, 'kind', 'SIGN_INS', 'accounts_removed', coalesce(p_removed, 0), 'replayed', false);
  insert into import_rollbacks (kind, batch_id, voided_by, reason, undone) values ('SIGN_INS', p_batch, p_actor, v_reason, v_undone);
  perform write_audit(p_actor, 'SIGN_IN_IMPORT_VOIDED', 'sign_in_import', p_batch::text, null, v_undone, v_reason, null);
  perform notify_users(users_with_permission('config.approve'), 'IMPORT_VOIDED', 'sign_in_import', p_batch::text, 'A sign-in import was voided',
    'A Super Admin rolled back a sign-in import: ' || coalesce(p_removed, 0) || ' unused account(s) were removed.', 'import-void:' || p_batch);
  return v_undone;
end $$;

-- ================================================================== historical import
alter table historical_import_batches drop constraint historical_import_batches_status_check;
alter table historical_import_batches add constraint historical_import_batches_status_check check (status in ('STAGING','STAGED','COMMITTED','VOIDED'));

-- What existed before the import ran, so that a void can tell new rows from old and put the old ones back.
create table history_prestate (
  batch_id      uuid primary key references historical_import_batches(id) on delete restrict,
  quarters      jsonb not null,            -- {quarter id: {status, activated_at, locked_at}}
  week_states   jsonb not null,            -- {reporting week id: status}
  objective_ids uuid[] not null,
  kr_ids        uuid[] not null,
  sub_ids       uuid[] not null,
  snapshot_ids  uuid[] not null,           -- quarterly score snapshots
  bu_created    jsonb not null,            -- {business unit id: created_at}
  captured_at   timestamptz not null default app_now()
);
alter table history_prestate enable row level security;                -- no grant: only the functions below

create or replace function history_commit(p_actor uuid, p_batch uuid, p_fill_gaps boolean, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb; b historical_import_batches;
begin
  perform require_permission(p_actor, 'history.import');
  if p_confirm is distinct from 'IMPORT HISTORY' then raise exception 'VALIDATION_ERROR' using detail = 'type IMPORT HISTORY to confirm'; end if;
  select * into b from historical_import_batches where id = p_batch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.status = 'COMMITTED' then return b.result || jsonb_build_object('already_committed', true); end if;
  if b.status <> 'STAGED' then raise exception 'HISTORY_BATCH_STATE' using detail = 'the file is still being read'; end if;
  -- the picture before anything changes (ADR-088); it is what makes a rollback possible
  insert into history_prestate (batch_id, quarters, week_states, objective_ids, kr_ids, sub_ids, snapshot_ids, bu_created)
    select p_batch,
      coalesce((select jsonb_object_agg(id::text, jsonb_build_object('status', status, 'activated_at', activated_at, 'locked_at', locked_at)) from quarters), '{}'::jsonb),
      coalesce((select jsonb_object_agg(id::text, status) from reporting_weeks), '{}'::jsonb),
      coalesce((select array_agg(id) from quarterly_objectives), '{}'), coalesce((select array_agg(id) from key_results), '{}'),
      coalesce((select array_agg(id) from sub_key_results), '{}'), coalesce((select array_agg(id) from quarterly_score_snapshots), '{}'),
      coalesce((select jsonb_object_agg(id::text, created_at) from business_units), '{}'::jsonb)
  on conflict (batch_id) do update set quarters = excluded.quarters, week_states = excluded.week_states, objective_ids = excluded.objective_ids, kr_ids = excluded.kr_ids,
    sub_ids = excluded.sub_ids, snapshot_ids = excluded.snapshot_ids, bu_created = excluded.bu_created, captured_at = excluded.captured_at;
  v := history_apply(p_batch, p_actor, p_fill_gaps);
  update historical_import_batches set status = 'COMMITTED', committed_at = app_now(), result = v where id = p_batch;
  perform write_audit(p_actor, 'HISTORICAL_IMPORT_COMMITTED', 'historical_import', p_batch::text, null,
    jsonb_build_object('file', b.file_name, 'reports', v->'reports', 'goals', v->'goals', 'tasks', v->'tasks', 'quarters_created', v->'quarters_created', 'fill_gaps', p_fill_gaps));
  return v;
end $$;

create or replace function history_void(p_actor uuid, p_batch uuid, p_reason text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text := import_void_gate(p_actor, p_reason, p_confirm);
  b historical_import_batches; pre history_prestate; v_prev import_rollbacks; v_org uuid; v_blockers jsonb := '[]'::jsonb;
  v_touched uuid[]; v_new_q uuid[]; w_ids uuid[]; r_ids uuid[]; g_ids uuid[]; t_ids uuid[]; v_pairs int; v_undone jsonb;
  c_tasks int := 0; c_goals int := 0; c_reports int := 0; c_weeks int := 0; c_snaps int := 0; c_q int := 0; c_bu int := 0;
  v_purge constant text[] := array['weekly_reports','smart_goals','tasks','task_status_history','weekly_compliance','weekly_score_snapshots','reporting_week_state_events','employee_kpi_snapshots'];
begin
  perform pg_advisory_xact_lock(hashtextextended('import-void:' || p_batch::text, 0));
  select * into b from historical_import_batches where id = p_batch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.status = 'VOIDED' then
    select * into v_prev from import_rollbacks where kind = 'HISTORY' and batch_id = p_batch order by voided_at desc limit 1;
    return coalesce(v_prev.undone, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  if b.status <> 'COMMITTED' then raise exception 'HISTORY_BATCH_STATE' using detail = 'only a committed import can be rolled back'; end if;
  if app_now() > b.committed_at + import_void_window() then
    raise exception 'IMPORT_VOID_WINDOW_CLOSED' using detail = 'the rollback window ended ' || to_char(b.committed_at + import_void_window(), 'YYYY-MM-DD HH24:MI') || '; correct scores through the late-report and amendment routes';
  end if;
  select * into pre from history_prestate where batch_id = p_batch;
  if not found then raise exception 'IMPORT_VOID_NOT_AVAILABLE' using detail = 'this import was committed before the picture of what existed was kept'; end if;
  select id into v_org from organisations limit 1;

  select coalesce(array_agg(distinct qq.id), '{}') into v_touched from quarters qq where qq.organisation_id = v_org
    and exists (select 1 from historical_import_rows h where h.batch_id = p_batch and date_trunc('quarter', h.monday)::date = qq.starts_on);
  select coalesce(array_agg(x), '{}') into v_new_q from unnest(v_touched) x where not (pre.quarters ? x::text);
  select coalesce(array_agg(rw.id), '{}') into w_ids from reporting_weeks rw where rw.quarter_id = any(v_touched) and not (pre.week_states ? rw.id::text);

  -- 1. weeks that existed before must be exactly as they were: the import cannot give them back their old state
  if exists (select 1 from reporting_weeks rw where rw.quarter_id = any(v_touched) and (pre.week_states ? rw.id::text) and rw.status is distinct from pre.week_states->>(rw.id::text)) then
    v_blockers := v_blockers || jsonb_build_object('why', 'a week that existed before the import was locked by it, so it cannot be put back');
  end if;
  select count(distinct (h.monday, h.bu_id)) into v_pairs from historical_import_rows h where h.batch_id = p_batch;
  select coalesce(array_agg(id), '{}') into r_ids from weekly_reports where reporting_week_id = any(w_ids);
  if cardinality(r_ids) <> v_pairs then v_blockers := v_blockers || jsonb_build_object('why', 'the reports in these weeks (' || cardinality(r_ids) || ') are not the ' || v_pairs || ' the import created'); end if;
  select coalesce(array_agg(id), '{}') into g_ids from smart_goals where weekly_report_id = any(r_ids);
  select coalesce(array_agg(id), '{}') into t_ids from tasks where smart_goal_id = any(g_ids);

  -- 2. nothing may depend on the imported records: amendments, exceptions, corrections, assistant findings and so on
  v_blockers := v_blockers || import_void_children('reporting_weeks'::regclass, w_ids, v_purge) || import_void_children('weekly_reports'::regclass, r_ids, v_purge)
                           || import_void_children('smart_goals'::regclass, g_ids, v_purge) || import_void_children('tasks'::regclass, t_ids, v_purge)
                           || import_void_children('quarters'::regclass, v_new_q, array['quarterly_objectives','quarterly_score_snapshots','reporting_weeks']);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception 'IMPORT_VOID_BLOCKED' using detail = (select jsonb_agg(x) from (select x from jsonb_array_elements(v_blockers) x limit 50) s)::text;
  end if;

  -- 3. remove what the import added, restore what it changed (one transaction: all or nothing)
  begin
    perform set_config('app.import_void', 'on', true);
    delete from task_status_history where task_id = any(t_ids);
    delete from tasks where id = any(t_ids); get diagnostics c_tasks = row_count;
    delete from smart_goals where id = any(g_ids); get diagnostics c_goals = row_count;
    perform import_void_purge('reporting_weeks'::regclass, w_ids, array['weekly_compliance','weekly_score_snapshots','reporting_week_state_events','employee_kpi_snapshots']);
    delete from weekly_reports where id = any(r_ids); get diagnostics c_reports = row_count;
    delete from reporting_weeks where id = any(w_ids); get diagnostics c_weeks = row_count;
    delete from quarterly_score_snapshots where quarter_id = any(v_touched) and id <> all(pre.snapshot_ids); get diagnostics c_snaps = row_count;
    delete from sub_key_results where id <> all(pre.sub_ids) and key_result_id in (select k.id from key_results k join quarterly_objectives o on o.id = k.objective_id where o.quarter_id = any(v_touched));
    delete from key_results where id <> all(pre.kr_ids) and objective_id in (select o.id from quarterly_objectives o where o.quarter_id = any(v_touched));
    delete from quarterly_objectives where id <> all(pre.objective_ids) and quarter_id = any(v_touched);
    delete from quarters where id = any(v_new_q); get diagnostics c_q = row_count;
    update quarters q set status = pre.quarters->(q.id::text)->>'status',
           activated_at = nullif(pre.quarters->(q.id::text)->>'activated_at', '')::timestamptz, locked_at = nullif(pre.quarters->(q.id::text)->>'locked_at', '')::timestamptz
     where q.id = any(v_touched) and (pre.quarters ? q.id::text);
    update business_units bu set created_at = (pre.bu_created->>(bu.id::text))::timestamptz
     where (pre.bu_created ? bu.id::text) and bu.created_at is distinct from (pre.bu_created->>(bu.id::text))::timestamptz; get diagnostics c_bu = row_count;
    perform set_config('app.import_void', 'off', true);
  exception when foreign_key_violation then
    perform set_config('app.import_void', 'off', true);
    raise exception 'IMPORT_VOID_BLOCKED' using detail = jsonb_build_array(jsonb_build_object('why', 'other records now depend on the imported data: ' || sqlerrm))::text;
  end;

  update historical_import_batches set status = 'VOIDED' where id = p_batch;
  v_undone := jsonb_build_object('batchId', p_batch, 'kind', 'HISTORY', 'reports_removed', c_reports, 'goals_removed', c_goals, 'tasks_removed', c_tasks, 'weeks_removed', c_weeks,
    'quarter_snapshots_removed', c_snaps, 'quarters_removed', c_q, 'units_dates_restored', c_bu, 'replayed', false);
  insert into import_rollbacks (kind, batch_id, voided_by, reason, undone) values ('HISTORY', p_batch, p_actor, v_reason, v_undone);
  perform write_audit(p_actor, 'HISTORICAL_IMPORT_VOIDED', 'historical_import', p_batch::text, jsonb_build_object('file', b.file_name), v_undone, v_reason, null);
  perform notify_users(users_with_permission('config.approve'), 'IMPORT_VOIDED', 'historical_import', p_batch::text, 'A historical import was voided',
    'A Super Admin rolled back the historical import of ' || b.file_name || '. The file can be imported again.', 'import-void:' || p_batch);
  return v_undone;
end $$;

-- ================================================================== one list for the import screens
create or replace function read_rollbackable_imports() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb := '{}'::jsonb;
begin
  if (select auth_has_permission('strategy.import')) then
    v := v || jsonb_build_object('strategy', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'file_name', s.file_name, 'row_count', s.row_count, 'at', s.created_at, 'result', s.result,
        'void_until', s.created_at + import_void_window(), 'voided_at', r.voided_at, 'void_reason', r.reason,
        'voidable', (r.id is null and app_now() <= s.created_at + import_void_window())) order by s.created_at desc), '[]'::jsonb)
      from (select * from strategy_import_batches order by created_at desc limit 10) s left join import_rollbacks r on r.kind = 'STRATEGY' and r.batch_id = s.id));
  end if;
  if (select auth_has_permission('history.import')) then
    v := v || jsonb_build_object('history', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'file_name', h.file_name, 'row_count', h.row_count, 'status', h.status, 'at', h.committed_at,
        'void_until', h.committed_at + import_void_window(), 'voided_at', (select max(r.voided_at) from import_rollbacks r where r.kind = 'HISTORY' and r.batch_id = h.id),
        'voidable', (h.status = 'COMMITTED' and app_now() <= h.committed_at + import_void_window())) order by h.committed_at desc), '[]'::jsonb)
      from (select * from historical_import_batches where status in ('COMMITTED','VOIDED') order by committed_at desc nulls last limit 10) h));
  end if;
  if (select auth_has_permission('users.manage')) then
    v := v || jsonb_build_object('signIns', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'user_count', s.user_count, 'at', s.created_at,
        'remaining', (select count(*) from sign_in_import_users i join users u on u.id = i.user_id where i.batch_id = s.id),
        'void_until', s.created_at + import_void_window(), 'voided_at', r.voided_at, 'void_reason', r.reason,
        'voidable', (r.id is null and app_now() <= s.created_at + import_void_window())) order by s.created_at desc), '[]'::jsonb)
      from (select * from sign_in_import_batches order by created_at desc limit 10) s left join import_rollbacks r on r.kind = 'SIGN_INS' and r.batch_id = s.id));
  end if;
  return v;
end $$;

select lock_down_function_grants();
