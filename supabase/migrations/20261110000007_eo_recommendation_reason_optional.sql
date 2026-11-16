-- "Make a recommendation" no longer asks why (ADR-128; owner request: remove the background, the reason, the improvement direction, priority, category,
-- module, responsible role and person, the response options and the links from the form). The reason was the one of those the database insisted on before
-- a recommendation could be issued. It is now optional: a recommendation can be issued with a title, the recommendation itself and the units it is
-- addressed to. A reason that is given is still kept and shown.

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'eo_recommendations'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reason IS NOT NULL%' loop
    execute format('alter table eo_recommendations drop constraint %I', c.conname);
  end loop;
end $$;

do $$
declare v_def text;
  a text := $a$okr_clean(p_reason, 10000, 'the reason for the recommendation', coalesce(p_publish, false))$a$;
  b text := $b$okr_clean(p_reason, 10000, 'the reason for the recommendation', false)$b$;
  d text := $d$if r.reason is null then raise exception 'VALIDATION_ERROR' using detail = 'say why you are recommending this'; end if;$d$;
begin
  v_def := pg_get_functiondef('save_eo_recommendation(uuid,uuid,integer,text,text,text,text,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid,boolean,date,uuid[],jsonb,boolean,text)'::regprocedure);
  if position(d in v_def) = 0 and position(a in v_def) = 0 then return; end if;
  execute replace(replace(v_def, a, b), d, '');
end $$;

do $$
declare v_def text;
  d text := $d$if r.reason is null then raise exception 'VALIDATION_ERROR' using detail = 'say why you are recommending this'; end if;$d$;
begin
  v_def := pg_get_functiondef('publish_eo_recommendation(uuid,uuid,integer,text)'::regprocedure);
  if position(d in v_def) = 0 then return; end if;
  execute replace(v_def, d, '');
end $$;

select lock_down_function_grants();
