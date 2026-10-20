-- Gap-closure plan, Phase B (ADR-079): strategy bulk import. A Super Admin loads the objective, key results and Sub-KRs of one or more quarters from a sheet.
-- It only ever fills a quarter that has no strategy yet and is not active: a quarter that has ended is stored LOCKED (so historical reports can be attached to
-- it), any other is stored PLANNED and is activated through the normal screen. An active quarter's strategy is a controlled baseline and is changed only by an
-- approved change request, so the import refuses it. Nothing is written unless the whole sheet is valid.
insert into permissions (code, description, protected, reserved) values
  ('strategy.import', 'Load the strategy of quarters (objective, key results, Sub-KRs) from a spreadsheet (Super Admin tier only)', true, true);
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'SUPER_ADMIN' and p.code = 'strategy.import';

create table strategy_import_batches (
  id           uuid primary key default gen_random_uuid(),
  file_name    text not null,
  file_sha256  text not null unique,
  row_count    int not null,
  result       jsonb not null,
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default app_now()
);
alter table strategy_import_batches enable row level security;
create trigger strategy_import_batches_immutable before update or delete on strategy_import_batches for each row execute function forbid_mutation();

-- rows: [{row_no, year, quarter, objective, kr_no, kr_title, sub_no, sub_title}]
create or replace function strategy_import_issues(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v jsonb := '[]'::jsonb; q record; k record; n int; v_status text; v_has boolean; v_first int;
begin
  select id into v_org from organisations limit 1;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return jsonb_build_array(jsonb_build_object('row', 0, 'message', 'The sheet has no rows.')); end if;
  if jsonb_array_length(p_rows) > 2000 then return jsonb_build_array(jsonb_build_object('row', 0, 'message', 'At most 2000 rows can be imported at once.')); end if;
  create temp table if not exists _si (row_no int, year int, quarter int, objective text, kr_no int, kr_title text, sub_no int, sub_title text) on commit drop;
  truncate _si;
  insert into _si select * from jsonb_to_recordset(p_rows) as r(row_no int, year int, quarter int, objective text, kr_no int, kr_title text, sub_no int, sub_title text);

  for q in select distinct year, quarter from _si order by 1, 2 loop
    select min(row_no) into v_first from _si where year = q.year and quarter = q.quarter;
    if q.year not between 2000 and 2100 or q.quarter not between 1 and 4 then
      v := v || jsonb_build_object('row', v_first, 'message', 'Year ' || coalesce(q.year::text, '?') || ' quarter ' || coalesce(q.quarter::text, '?') || ' is not a valid quarter.'); continue;
    end if;
    select status, exists (select 1 from quarterly_objectives o where o.quarter_id = qq.id) into v_status, v_has from quarters qq where organisation_id = v_org and year = q.year and quarter_number = q.quarter;
    if v_status = 'ACTIVE' then v := v || jsonb_build_object('row', v_first, 'message', q.year || ' Q' || q.quarter || ' is active. Its strategy is a controlled baseline: ask for a change instead of importing.'); end if;
    if v_has then v := v || jsonb_build_object('row', v_first, 'message', q.year || ' Q' || q.quarter || ' already has an objective. The import fills empty quarters only.'); end if;
    if (select count(distinct btrim(objective)) from _si where year = q.year and quarter = q.quarter) <> 1 or exists (select 1 from _si where year = q.year and quarter = q.quarter and coalesce(btrim(objective), '') = '') then
      v := v || jsonb_build_object('row', v_first, 'message', q.year || ' Q' || q.quarter || ' needs exactly one objective, written the same on every row.');
    end if;
    if exists (select 1 from _si where year = q.year and quarter = q.quarter and char_length(objective) > 1000) then v := v || jsonb_build_object('row', v_first, 'message', 'The objective is longer than 1000 characters.'); end if;

    select count(distinct kr_no) into n from _si where year = q.year and quarter = q.quarter;
    if n < 3 or n > 4 then v := v || jsonb_build_object('row', v_first, 'message', q.year || ' Q' || q.quarter || ' has ' || n || ' key results. A quarter needs 3 or 4.'); end if;
    if exists (select 1 from _si where year = q.year and quarter = q.quarter and (kr_no is null or kr_no not between 1 and 4)) then
      v := v || jsonb_build_object('row', v_first, 'message', 'Key result numbers must be 1 to 4.');
    elsif (select max(kr_no) from _si where year = q.year and quarter = q.quarter) <> n then
      v := v || jsonb_build_object('row', v_first, 'message', 'Key result numbers must run 1, 2, 3 (and 4) without gaps.');
    end if;
    for k in select kr_no from _si where year = q.year and quarter = q.quarter and kr_no between 1 and 4 group by kr_no order by kr_no loop
      if (select count(distinct btrim(kr_title)) from _si where year = q.year and quarter = q.quarter and kr_no = k.kr_no) <> 1 or exists (select 1 from _si where year = q.year and quarter = q.quarter and kr_no = k.kr_no and coalesce(btrim(kr_title), '') = '') then
        v := v || jsonb_build_object('row', (select min(row_no) from _si where year = q.year and quarter = q.quarter and kr_no = k.kr_no), 'message', 'KR ' || k.kr_no || ' needs one title, written the same on every row.');
      end if;
      select count(distinct sub_no) into n from _si where year = q.year and quarter = q.quarter and kr_no = k.kr_no;
      if exists (select 1 from _si where year = q.year and quarter = q.quarter and kr_no = k.kr_no and (sub_no is null or sub_no < 1)) or (select max(sub_no) from _si where year = q.year and quarter = q.quarter and kr_no = k.kr_no) <> n then
        v := v || jsonb_build_object('row', (select min(row_no) from _si where year = q.year and quarter = q.quarter and kr_no = k.kr_no), 'message', 'KR ' || k.kr_no || ': Sub-KR numbers must run 1, 2, 3 without gaps, and each KR needs at least one.');
      end if;
    end loop;
  end loop;

  -- row-level text checks and duplicates
  for k in select row_no, case
        when coalesce(btrim(sub_title), '') = '' then 'The Sub-KR has no title.'
        when char_length(sub_title) > 1000 or char_length(kr_title) > 1000 then 'A title is longer than 1000 characters.'
        when sub_title ~ '^[=+@]' or kr_title ~ '^[=+@]' or objective ~ '^[=+@]' then 'A text starts with a formula character (= + @).'
        when exists (select 1 from _si b where b.year = a.year and b.quarter = a.quarter and b.kr_no = a.kr_no and b.sub_no = a.sub_no and b.row_no < a.row_no) then 'This Sub-KR number appears twice under the same key result.'
      end as message from _si a loop
    if k.message is not null then v := v || jsonb_build_object('row', k.row_no, 'message', k.message); end if;
  end loop;
  return v;
end $$;

create or replace function strategy_import_commit(p_actor uuid, p_rows jsonb, p_file text, p_sha text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_issues jsonb; q record; v_q quarters; v_obj uuid; k record; v_kr uuid; sk record; v_b strategy_import_batches; v_out jsonb;
        v_quarters jsonb := '[]'::jsonb; nq int := 0; nk int := 0; ns int := 0; v_ended boolean; v_start date;
begin
  perform require_permission(p_actor, 'strategy.import');
  if p_confirm is distinct from 'IMPORT STRATEGY' then raise exception 'VALIDATION_ERROR' using detail = 'type IMPORT STRATEGY to confirm'; end if;
  if p_sha is null or p_sha !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_ERROR' using detail = 'file checksum required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('strategy-import', 0));
  select * into v_b from strategy_import_batches where file_sha256 = p_sha;
  if found then return v_b.result || jsonb_build_object('already_imported', true); end if;
  v_issues := strategy_import_issues(p_rows);
  if jsonb_array_length(v_issues) > 0 then raise exception 'IMPORT_INVALID' using detail = (select jsonb_agg(e) from (select e from jsonb_array_elements(v_issues) e limit 50) s)::text; end if;
  select id into v_org from organisations limit 1;

  for q in select distinct year, quarter from jsonb_to_recordset(p_rows) as r(year int, quarter int) order by 1, 2 loop
    v_start := make_date(q.year, (q.quarter - 1) * 3 + 1, 1);
    v_ended := app_now() >= (((v_start + interval '3 months')::date)::timestamp at time zone 'Africa/Lagos');
    select * into v_q from quarters where organisation_id = v_org and year = q.year and quarter_number = q.quarter;
    if not found then
      insert into quarters (organisation_id, year, quarter_number, starts_on, ends_on, status, activated_at, locked_at)
        values (v_org, q.year, q.quarter, v_start, (v_start + interval '3 months' - interval '1 day')::date,
                case when v_ended then 'LOCKED' else 'PLANNED' end, case when v_ended then v_start::timestamp at time zone 'Africa/Lagos' end, case when v_ended then app_now() end)
        returning * into v_q;
    elsif v_ended and v_q.status <> 'LOCKED' then
      update quarters set status = 'LOCKED', activated_at = coalesce(activated_at, v_start::timestamp at time zone 'Africa/Lagos'), locked_at = coalesce(locked_at, app_now()) where id = v_q.id returning * into v_q;
    end if;
    insert into quarterly_objectives (quarter_id, title, created_by)
      select v_q.id, btrim(min(objective)), p_actor from jsonb_to_recordset(p_rows) as r(year int, quarter int, objective text) where r.year = q.year and r.quarter = q.quarter returning id into v_obj;
    nq := nq + 1;
    for k in select r.kr_no, btrim(min(r.kr_title)) as title from jsonb_to_recordset(p_rows) as r(year int, quarter int, kr_no int, kr_title text) where r.year = q.year and r.quarter = q.quarter group by r.kr_no order by r.kr_no loop
      insert into key_results (objective_id, sequence, code, title) values (v_obj, k.kr_no, 'KR' || k.kr_no, k.title) returning id into v_kr;
      nk := nk + 1;
      for sk in select s.sub_no, btrim(s.sub_title) as title from jsonb_to_recordset(p_rows) as s(year int, quarter int, kr_no int, sub_no int, sub_title text) where s.year = q.year and s.quarter = q.quarter and s.kr_no = k.kr_no order by s.sub_no loop
        insert into sub_key_results (key_result_id, sequence, code, title) values (v_kr, sk.sub_no, 'KR' || k.kr_no || '.' || sk.sub_no, sk.title);
        ns := ns + 1;
      end loop;
    end loop;
    v_quarters := v_quarters || jsonb_build_object('year', q.year, 'quarter', q.quarter, 'status', v_q.status);
  end loop;

  v_out := jsonb_build_object('quarters', v_quarters, 'objectives', nq, 'key_results', nk, 'sub_key_results', ns);
  insert into strategy_import_batches (file_name, file_sha256, row_count, result, created_by) values (left(p_file, 200), p_sha, jsonb_array_length(p_rows), v_out, p_actor);
  perform write_audit(p_actor, 'STRATEGY_IMPORTED', 'organisation', v_org::text, null, v_out || jsonb_build_object('file', left(p_file, 200)));
  return v_out;
end $$;

select lock_down_function_grants();
