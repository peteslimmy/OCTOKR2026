-- A Super Admin may file and work a weekly report on behalf of any Business Unit that files weekly reports (owner decision, ADR-085).
-- Everything else about the report is unchanged: it belongs to that unit, the locks and the holiday rule apply, and the audit trail records who acted:
-- the Super Admin is the actor, the unit is the scope, and creating or submitting on someone's behalf writes its own entry.

insert into permissions (code, description) values ('weekly_report.file_for_any_bu', 'File and work a weekly report on behalf of any Business Unit that files weekly reports');
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'SUPER_ADMIN' and p.code = 'weekly_report.file_for_any_bu';

create or replace function actor_may_file_for(p_actor uuid, p_bu uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_bu is not null and (actor_bu(p_actor) = p_bu or actor_has_permission(p_actor, 'weekly_report.file_for_any_bu'));
$$;

-- the unit check in every function that works a report
do $$
declare v_sig text; v_def text; v_n int;
begin
  foreach v_sig in array array[
    'acquire_edit_lease(uuid,uuid,integer)', 'assert_report_editable(uuid,uuid,text,integer)', 'delete_weekly_report(uuid,uuid)',
    'execute_task(uuid,uuid,text)', 'set_skipped_summary(uuid,uuid,text)', 'submit_weekly_report(uuid,uuid,text,integer)'] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_n := 0;
    if position('actor_bu(p_actor) is distinct from v_r.business_unit_id' in v_def) > 0 then
      v_def := replace(v_def, 'actor_bu(p_actor) is distinct from v_r.business_unit_id', 'not actor_may_file_for(p_actor, v_r.business_unit_id)'); v_n := v_n + 1;
    end if;
    if position('v_bu is distinct from v_r.business_unit_id' in v_def) > 0 then
      v_def := replace(v_def, 'v_bu is distinct from v_r.business_unit_id', 'not actor_may_file_for(p_actor, v_r.business_unit_id)'); v_n := v_n + 1;
    end if;
    if v_n = 0 then raise exception '% no longer contains the expected unit check', v_sig; end if;
    execute v_def;
  end loop;
end $$;

-- creating a report: an optional unit, honoured only for someone who may file for any unit
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('get_or_create_weekly_report(uuid,uuid)'::regprocedure);
  if position('v_bu := actor_bu(p_actor);' in v_def) = 0 or position('(p_actor uuid, p_week_id uuid)' in v_def) = 0 then raise exception 'get_or_create_weekly_report no longer contains the expected lines'; end if;
  v_def := replace(v_def, '(p_actor uuid, p_week_id uuid)', '(p_actor uuid, p_week_id uuid, p_bu uuid DEFAULT NULL)');
  v_def := replace(v_def, 'v_bu := actor_bu(p_actor);',
    'v_bu := case when p_bu is not null and p_bu is distinct from actor_bu(p_actor) then (case when actor_has_permission(p_actor, ''weekly_report.file_for_any_bu'') then p_bu else null end) else actor_bu(p_actor) end;');
  if position('perform write_audit(p_actor, ''REPORT_CREATED'', ''weekly_report'', v_id::text, null, jsonb_build_object(''week_id'', p_week_id), null, v_bu);' in v_def) = 0 then raise exception 'REPORT_CREATED audit line not found'; end if;
  v_def := replace(v_def, 'perform write_audit(p_actor, ''REPORT_CREATED'', ''weekly_report'', v_id::text, null, jsonb_build_object(''week_id'', p_week_id), null, v_bu);',
    'perform write_audit(p_actor, ''REPORT_CREATED'', ''weekly_report'', v_id::text, null, jsonb_build_object(''week_id'', p_week_id, ''on_behalf_of_unit'', v_bu is distinct from actor_bu(p_actor)), null, v_bu);');
  drop function get_or_create_weekly_report(uuid, uuid);
  execute v_def;
end $$;

select lock_down_function_grants();
