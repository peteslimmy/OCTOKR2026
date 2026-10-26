\pset pager off
\echo === 1. public tables without RLS
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity order by 1;
\echo === 2. RLS-enabled tables with no policy (default deny for non-owner)
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid=c.oid) order by 1;
\echo === 3. write privileges held by anon/authenticated on public tables
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) privs from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE') group by 1,2 order by 1,2;
\echo === 4. anon privileges of any kind on public tables
select table_name, string_agg(privilege_type, ',') from information_schema.role_table_grants where table_schema='public' and grantee='anon' group by 1 order by 1;
\echo === 5. counts
select (select count(*) from pg_tables where schemaname='public') tables, (select count(*) from pg_policy) policies, (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) triggers, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f') functions, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosecdef) security_definer;
\echo === 6. functions callable by authenticated that are SECURITY DEFINER (they run with owner rights)
select p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1;
\echo === 7. functions callable by anon
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1;
\echo === 8. SECURITY DEFINER functions with no search_path pinned
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') order by 1;
\echo === 9. definer, service-only functions whose source has no permission/actor check (candidate review list)
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosecdef and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.prosrc !~* 'require_permission|has_permission|actor_has|auth_has|p_actor|is_super|role' order by 1;
