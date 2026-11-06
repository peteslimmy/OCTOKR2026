-- ADR-108: the 4COREPAL AI assistant was removed from the application (ADR-104); this removes what it left in the database.
-- The scheduler stops calling the AI job runner, then the AI tables, functions, permissions and notification types are dropped.
-- The minutes' own ai_drafted / ai_model columns are kept: minutes are immutable history and other records hash them.

-- 1. the scheduler no longer runs the AI jobs
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('run_scheduled_jobs'::regproc);
  v_def := replace(v_def, 'begin perform ai_run_jobs(); exception when others then null; end; ', '');
  if v_def like '%ai_run_jobs%' then raise exception 'run_scheduled_jobs still calls ai_run_jobs; the patch did not match'; end if;
  execute v_def;
end $$;

-- 2. the AI tables (their triggers go with them)
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'ai\_%' loop
    execute format('drop table if exists public.%I cascade', t.tablename);
  end loop;
end $$;

-- 3. the AI functions
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace and (p.proname like 'ai\_%' or p.proname like 'read\_ai\_%' or p.proname = 'record_okr_ai_summary')
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

-- 4. the AI permissions, from every role, then from the catalogue
delete from role_permissions where permission_id in (select id from permissions where code like 'ai.%');
delete from user_permission_grants where permission_id in (select id from permissions where code like 'ai.%');
delete from permission_conflicts where permission_a like 'ai.%' or permission_b like 'ai.%';
delete from permissions where code like 'ai.%';

-- 5. the AI notification types
delete from email_event_types where event_type like 'AI\_%';
