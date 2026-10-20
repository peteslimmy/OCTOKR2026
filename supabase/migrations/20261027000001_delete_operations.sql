-- Delete operations for Business Units, Users, and Weekly Reports (draft only)
-- All mutations are SECURITY DEFINER functions executable by service_role only (ADR-035).

-- ---------------------------------------------------------------- delete business unit / department
create or replace function delete_business_unit(p_actor uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bu business_units;
  v_emp_count int;
  v_report_count int;
begin
  perform require_permission(p_actor, 'business_units.manage');

  select * into v_bu from business_units where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  -- Check for dependent employees
  select count(*) into v_emp_count from employees where business_unit_id = p_id;
  if v_emp_count > 0 then
    raise exception 'VALIDATION_ERROR' using detail = 'Cannot delete: ' || v_emp_count || ' employee(s) belong to this unit. Reassign them first.';
  end if;

  -- Check for dependent weekly reports
  select count(*) into v_report_count from weekly_reports where business_unit_id = p_id;
  if v_report_count > 0 then
    raise exception 'VALIDATION_ERROR' using detail = 'Cannot delete: ' || v_report_count || ' weekly report(s) exist for this unit.';
  end if;

  -- Prevent deleting the last BU (organisation must have at least one)
  if (select count(*) from business_units) <= 1 then
    raise exception 'VALIDATION_ERROR' using detail = 'Cannot delete the last Business Unit.';
  end if;

  delete from business_units where id = p_id;
  perform write_audit(p_actor, 'BU_DELETED', 'business_unit', p_id::text,
    jsonb_build_object('code', v_bu.code, 'name', v_bu.name, 'status', v_bu.status, 'reports_weekly', v_bu.reports_weekly),
    null, null, p_id);
end $$;

-- ---------------------------------------------------------------- delete user (with auth cleanup)
create or replace function delete_user(p_actor uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user users;
  v_old_roles text[];
  v_super_admin_count int;
  v_admin_count int;
  v_actor_roles text[];
  v_target_roles text[];
begin
  perform require_permission(p_actor, 'users.manage');

  if p_user = p_actor then
    raise exception 'VALIDATION_ERROR' using detail = 'You cannot delete your own account.';
  end if;

  select * into v_user from users where id = p_user for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  v_old_roles := actor_role_codes(p_user);
  v_actor_roles := actor_role_codes(p_actor);
  v_target_roles := v_old_roles;

  -- Prevent removing the last SUPER_ADMIN
  if 'SUPER_ADMIN' = any(v_target_roles) then
    select count(*) into v_super_admin_count
    from user_roles ur join roles r on r.id = ur.role_id
    where r.code = 'SUPER_ADMIN' and ur.user_id <> p_user
      and exists (select 1 from users u where u.id = ur.user_id and u.status = 'ACTIVE');
    if v_super_admin_count = 0 then
      raise exception 'VALIDATION_ERROR' using detail = 'Cannot delete the last active Super Admin.';
    end if;
  end if;

  -- Prevent removing the last ADMIN if actor is not SUPER_ADMIN
  if 'ADMIN' = any(v_target_roles) and not ('SUPER_ADMIN' = any(v_actor_roles)) then
    select count(*) into v_admin_count
    from user_roles ur join roles r on r.id = ur.role_id
    where r.code = 'ADMIN' and ur.user_id <> p_user
      and exists (select 1 from users u where u.id = ur.user_id and u.status = 'ACTIVE');
    if v_admin_count = 0 then
      raise exception 'VALIDATION_ERROR' using detail = 'Cannot delete the last active Admin.';
    end if;
  end if;

  -- Delete user_roles (cascades via FK)
  delete from user_roles where user_id = p_user;

  -- Delete user (cascades to auth.users via FK? No, users.id references auth.users, so we must delete auth user too)
  delete from users where id = p_user;

  -- Note: The auth.users deletion is handled by the API layer calling adminClient.auth.admin.deleteUser()
  -- because it requires service_role key and cannot be done from within a SECURITY DEFINER function.

  perform write_audit(p_actor, 'USER_DELETED', 'user', p_user::text,
    jsonb_build_object('email', v_user.email, 'status', v_user.status, 'roles', v_old_roles),
    null, null, v_user.employee_id);
end $$;

-- ---------------------------------------------------------------- delete weekly report (draft only)
create or replace function delete_weekly_report(p_actor uuid, p_report_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_r weekly_reports;
  v_w reporting_weeks;
  v_bu uuid;
begin
  perform require_permission(p_actor, 'weekly_report.create');

  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  v_bu := actor_bu(p_actor);
  if v_bu is distinct from v_r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;

  select * into v_w from reporting_weeks where id = v_r.reporting_week_id;
  if not found then raise exception 'NOT_FOUND'; end if;

  -- Only allow deletion of draft (NOT_SUBMITTED) reports in OPEN state
  if v_r.submission_status <> 'NOT_SUBMITTED' then
    raise exception 'VALIDATION_ERROR' using detail = 'Only draft (not submitted) reports can be deleted.';
  end if;
  if v_r.status <> 'OPEN' then
    raise exception 'VALIDATION_ERROR' using detail = 'Only reports in OPEN state can be deleted.';
  end if;

  -- Cannot delete if week is an organization holiday
  if v_w.reporting_state = 'ORGANIZATION_HOLIDAY' then
    raise exception 'REPORTING_NOT_REQUIRED';
  end if;

  -- Cannot delete if week is final-locked (should be covered by status check but belt-and-suspenders)
  if report_phase(v_w.id) = 'FINAL_LOCKED' then
    raise exception 'REPORT_FINAL_LOCKED';
  end if;

  delete from weekly_reports where id = p_report_id;
  -- Cascades to: report_edit_sessions (ON DELETE CASCADE), smart_goals (ON DELETE RESTRICT but deleted with report),
  -- tasks (ON DELETE RESTRICT but deleted with goals), smart_evaluations (ON DELETE RESTRICT)

  perform write_audit(p_actor, 'REPORT_DELETED', 'weekly_report', p_report_id::text,
    jsonb_build_object('business_unit_id', v_r.business_unit_id, 'reporting_week_id', v_r.reporting_week_id, 'status', v_r.status, 'submission_status', v_r.submission_status),
    null, null, v_bu);
end $$;

select lock_down_function_grants();