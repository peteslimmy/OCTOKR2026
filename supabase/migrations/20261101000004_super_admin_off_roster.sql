-- The Super Admin account is a reserve account kept out of the organisation's rosters and counts.
update employees e set on_attendance_roster = false, updated_at = app_now()
where e.on_attendance_roster
  and exists (select 1 from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where u.employee_id = e.id and r.code = 'SUPER_ADMIN');
