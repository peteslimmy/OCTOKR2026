-- Names on request and decision screens were read with the viewer's own access, so a person who may not open someone else's profile (Finance reading a request
-- raised by a BU lead) saw a blank or a wrong label. person_name() gives the name of whoever acted; the reserve Super Admin account still shows only as
-- "Administration" to everyone but a Super Admin.
create or replace function person_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when is_super_admin(u.id) and u.id <> auth.uid() and not is_super_admin(auth.uid()) then 'Administration' else e.first_name || ' ' || e.last_name end
    from users u join employees e on e.id = u.employee_id where u.id = p_user;
$$;

do $$
declare f text; v_def text; v_new text;
begin
  foreach f in array array['read_amendment_requests', 'read_holiday_amendment_requests', 'read_holiday_amendments', 'read_late_report_exceptions', 'read_ledger_reversals',
                           'read_report_governance_items', 'read_report_integrity', 'read_session_corrections', 'read_session_roster', 'read_strategy_changes',
                           'read_disbursement_requests', 'read_config_changes'] loop
    v_def := pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f));
    -- (select X.first_name || ' ' || X.last_name from users U join employees X on X.id = U.employee_id where U.id = EXPR)  ->  person_name(EXPR)
    v_new := regexp_replace(v_def, '\(select (\w+)\.first_name \|\| '' '' \|\| \1\.last_name from users (\w+) join employees \1 on \1\.id = \2\.employee_id where \2\.id = ([\w.]+)\)', 'person_name(\3)', 'g');
    if f = 'read_config_changes' then
      v_new := replace(v_new, 'coalesce(re.first_name || '' '' || re.last_name, ru.email::text)', 'coalesce(person_name(c.requested_by), ''Unknown'')');
      v_new := replace(v_new, 'coalesce(de.first_name || '' '' || de.last_name, du.email::text)', 'person_name(c.decided_by)');
      v_new := regexp_replace(v_new, 'join users ru on ru\.id = c\.requested_by left join employees re on re\.id = ru\.employee_id\s+left join users du on du\.id = c\.decided_by left join employees de on de\.id = du\.employee_id', '');
    end if;
    if f = 'read_late_report_exceptions' then
      v_new := replace(v_new, 'coalesce(ea.first_name || '' '' || ea.last_name, ''Administrator'')', 'coalesce(person_name(e.authorised_by), ''Administrator'')');
    end if;
    if v_new = v_def then raise exception 'nothing changed in %', f; end if;
    execute v_new;
  end loop;
end $$;
select lock_down_function_grants();
-- the read_* functions run as the caller and call this one, so the caller may run it (it reveals only a name, and hides the reserve account)
grant execute on function person_name(uuid) to authenticated;
