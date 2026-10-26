-- User deletion now records WHY. The screens already ask for a reason ("required, audited"), but the routes dropped it and the audit row
-- carried none (audit finding F-007). The reason is mandatory and stored on the USER_DELETED audit entry.

drop function if exists delete_user(uuid, uuid);
create or replace function delete_user(p_actor uuid, p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user users;
  v_old_roles text[];
  v_super_admin_count int;
  v_admin_count int;
  v_actor_roles text[];
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'users.manage');

  if v_reason is null then
    raise exception 'VALIDATION_ERROR' using detail = 'A reason is required to delete a user.';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'VALIDATION_ERROR' using detail = 'The reason is limited to 2000 characters.';
  end if;
  if p_user = p_actor then
    raise exception 'VALIDATION_ERROR' using detail = 'You cannot delete your own account.';
  end if;

  select * into v_user from users where id = p_user for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  v_old_roles := actor_role_codes(p_user);
  v_actor_roles := actor_role_codes(p_actor);

  -- the last active Super Admin can never be deleted
  if 'SUPER_ADMIN' = any(v_old_roles) then
    select count(*) into v_super_admin_count
    from user_roles ur join roles r on r.id = ur.role_id
    where r.code = 'SUPER_ADMIN' and ur.user_id <> p_user
      and exists (select 1 from users u where u.id = ur.user_id and u.status = 'ACTIVE');
    if v_super_admin_count = 0 then
      raise exception 'VALIDATION_ERROR' using detail = 'Cannot delete the last active Super Admin.';
    end if;
  end if;

  -- an Admin who is not a Super Admin cannot delete the last active Admin
  if 'ADMIN' = any(v_old_roles) and not ('SUPER_ADMIN' = any(v_actor_roles)) then
    select count(*) into v_admin_count
    from user_roles ur join roles r on r.id = ur.role_id
    where r.code = 'ADMIN' and ur.user_id <> p_user
      and exists (select 1 from users u where u.id = ur.user_id and u.status = 'ACTIVE');
    if v_admin_count = 0 then
      raise exception 'VALIDATION_ERROR' using detail = 'Cannot delete the last active Admin.';
    end if;
  end if;

  delete from user_roles where user_id = p_user;
  delete from users where id = p_user;
  -- the sign-in identity (auth.users) is removed by the API layer: it needs the service role

  perform write_audit(p_actor, 'USER_DELETED', 'user', p_user::text,
    jsonb_build_object('email', v_user.email, 'status', v_user.status, 'roles', v_old_roles),
    null, v_reason, v_user.employee_id);
end $$;

select lock_down_function_grants();
