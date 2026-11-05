-- A person whose account was created with a password someone else chose must replace it at first sign-in.
-- The flag is set when the account is created and cleared when the password is changed or reset.
alter table users add column must_change_password boolean not null default false;

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('record_password_changed(uuid,text)'::regprocedure);
  if position('update users set failed_attempts = 0, locked_until = null where id = p_user;' in v_def) = 0 then raise exception 'record_password_changed changed'; end if;
  execute replace(v_def, 'update users set failed_attempts = 0, locked_until = null where id = p_user;', 'update users set failed_attempts = 0, locked_until = null, must_change_password = false where id = p_user;');
end $$;

select lock_down_function_grants();
