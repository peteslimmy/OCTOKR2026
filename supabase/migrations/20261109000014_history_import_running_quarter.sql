-- Historical import accepts weeks of the running quarter (ADR-122; owner request: "upload historical up to a week before the present").
-- Until now only quarters that had ended could be loaded. Now a week of the quarter in progress can be loaded once that week has closed
-- (the existing "has not closed yet" rule), provided the quarter is ACTIVE in the application and every Sub-KR in the file already exists in its strategy.
-- The import never locks a running quarter, never adds placeholder strategy to it, and never fills gap weeks in it.

do $$
declare v_def text;
  a text := $a$when app_now() < ((w.next_quarter_start)::timestamp at time zone 'Africa/Lagos') then 'This week belongs to a quarter that has not ended. Only closed quarters can be loaded here.'$a$;
  b text := $b$when app_now() < ((w.next_quarter_start)::timestamp at time zone 'Africa/Lagos') and not exists (select 1 from quarters qq where qq.starts_on = date_trunc('quarter', w.monday)::date and qq.status = 'ACTIVE') then 'This week belongs to a quarter that has not ended and is not the active quarter. Only closed quarters, or weeks of the active quarter, can be loaded here.'
      when app_now() < ((w.next_quarter_start)::timestamp at time zone 'Africa/Lagos') and w.sub_kr is not null and not exists (select 1 from sub_key_results s join key_results k on k.id = s.key_result_id join quarterly_objectives o on o.id = k.objective_id join quarters qq on qq.id = o.quarter_id where qq.starts_on = date_trunc('quarter', w.monday)::date and k.sequence = split_part(w.sub_kr, '.', 1)::int and s.sequence = split_part(w.sub_kr, '.', 2)::int) then 'The Sub-KR ' || w.sub_kr || ' is not in the strategy of the active quarter; the strategy of a running quarter is not changed by this import.'$b$;
begin
  v_def := pg_get_functiondef('history_issues(uuid)'::regprocedure);
  if position('is not the active quarter' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'history_issues changed'; end if;
  execute replace(v_def, a, b);
end $$;

do $$
declare v_def text;
  a1 text := $a$elsif v_q.status <> 'LOCKED' then$a$;
  b1 text := $b$elsif v_q.status <> 'LOCKED' and app_now() >= ((q.qs + interval '3 months')::timestamp at time zone 'Africa/Lagos') then$b$;
  a2 text := $a$for q in select id from quarters where id = any(v_touched) loop$a$;
  b2 text := $b$for q in select id from quarters where id = any(v_touched) and ends_on < (app_now() at time zone 'Africa/Lagos')::date loop$b$;
  a3 text := $a$and (p_fill_gaps or (rw.week_start_at$a$;
  b3 text := $b$and ((p_fill_gaps and exists (select 1 from quarters qq where qq.id = rw.quarter_id and qq.ends_on < (app_now() at time zone 'Africa/Lagos')::date)) or (rw.week_start_at$b$;
begin
  v_def := pg_get_functiondef('history_apply(uuid,uuid,boolean)'::regprocedure);
  if position('((q.qs + interval ''3 months'')::timestamp' in v_def) > 0 then return; end if;
  if position(a1 in v_def) = 0 or position(a2 in v_def) = 0 or position(a3 in v_def) = 0 then raise exception 'history_apply changed'; end if;
  execute replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3);
end $$;

select lock_down_function_grants();
