-- An Admin may upload and commit historical reports (ADR-122; owner request). Until now only a Super Admin could (ADR-077).
-- The safeguards are unchanged and now apply to the Admin: the rehearsal, the typed confirmation IMPORT HISTORY, a fresh authenticator code, the audit entry,
-- and the rollback window. New: every commit by someone who is not a Super Admin is told to the Super Admins, and an Admin may undo their own batch
-- (never another person's) inside the rollback window; undoing anyone else's batch stays a Super Admin action.

-- the permission stays protected (changing who holds it needs a Super Admin's approval) but is no longer reserved to roles that can manage roles
update permissions
   set reserved = false,
       description = 'Upload, rehearse and commit historical weekly reports for closed quarters (Super Admin and Admin; every commit by an Admin is told to the Super Admins)'
 where code = 'history.import';
insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r cross join permissions p where r.code = 'ADMIN' and p.code = 'history.import'
on conflict do nothing;

-- the notification a commit by an Admin sends to every Super Admin (an e-mail too, unless they turned non-security e-mail off)
insert into email_event_types (event_type, mandatory, description)
values ('HISTORY_IMPORT_COMMITTED', false, 'An Admin committed a historical import')
on conflict do nothing;

do $$
declare v_def text;
  a text := 'jsonb_build_object(''file'', b.file_name, ''reports'', v->''reports'', ''goals'', v->''goals'', ''tasks'', v->''tasks'', ''quarters_created'', v->''quarters_created'', ''fill_gaps'', p_fill_gaps));';
begin
  v_def := pg_get_functiondef('history_commit(uuid,uuid,boolean,text)'::regprocedure);
  if position('HISTORY_IMPORT_COMMITTED' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'history_commit changed'; end if;
  execute replace(v_def, a, a || ' '
    || 'if not is_super_admin(p_actor) then perform notify_users(users_with_role(''SUPER_ADMIN''), ''HISTORY_IMPORT_COMMITTED'', ''historical_import'', p_batch::text, '
    || '''A historical import was committed'', person_name(p_actor) || '' committed the historical import "'' || b.file_name || ''": '' || coalesce(v->>''reports'', ''0'') || '' reports, '' || coalesce(v->>''goals'', ''0'') || '' goals, '' || coalesce(v->>''tasks'', ''0'') || '' tasks. It can be rolled back inside the rollback window.'', '
    || '''history_import:'' || p_batch::text); end if;');
end $$;

-- undoing a batch: a Super Admin as before; an Admin only their own
create or replace function history_void_gate_admin(p_actor uuid, p_batch uuid, p_reason text, p_confirm text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'history.import');
  if not exists (select 1 from historical_import_batches where id = p_batch and created_by = p_actor) then
    raise exception 'PERMISSION_DENIED' using detail = 'you can undo only a historical import you loaded yourself; ask a Super Admin to undo someone else''s';
  end if;
  if p_confirm is distinct from 'VOID IMPORT' then raise exception 'VALIDATION_ERROR' using detail = 'type VOID IMPORT to confirm'; end if;
  if v_reason is null or char_length(v_reason) < 10 then raise exception 'REASON_REQUIRED' using detail = 'give a reason of at least 10 characters'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  return v_reason;
end $$;

do $$
declare v_def text; a text := 'import_void_gate(p_actor, p_reason, p_confirm)';
begin
  v_def := pg_get_functiondef('history_void(uuid,uuid,text,text)'::regprocedure);
  if position('history_void_gate_admin' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'history_void changed'; end if;
  execute replace(v_def, a, 'case when is_super_admin(p_actor) then import_void_gate(p_actor, p_reason, p_confirm) else history_void_gate_admin(p_actor, p_batch, p_reason, p_confirm) end');
end $$;

select lock_down_function_grants();
