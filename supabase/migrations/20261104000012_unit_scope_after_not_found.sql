-- In six functions the unit-scope check had been placed between "select ... into" and "if not found", and PERFORM resets FOUND, so a missing record was no longer reported
-- as NOT_FOUND (a violation edit with an unknown id answered "ok"). The not-found check now comes first, and the scope check after it.
do $$
declare f regprocedure; v_def text; v_new text;
begin
  foreach f in array array[
    'set_attendance_status(uuid,uuid,text,text)'::regprocedure, 'submit_attendance_amendment(uuid,uuid,text,text,jsonb,text)'::regprocedure,
    'create_violation(uuid,uuid,uuid,uuid,numeric,text,text,text)'::regprocedure, 'update_violation(uuid,uuid,numeric,text,text)'::regprocedure,
    'record_violation_payment(uuid,uuid,text,text,date,text)'::regprocedure, 'void_violation(uuid,uuid,text)'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    v_new := regexp_replace(v_def, '(select \* into \w+ from \w+ where id = \w+( for update)?;) (perform assert_unit_scope\([^\n]*\);)(\s*\n\s*)(if not found then raise exception ''NOT_FOUND''; end if;)', '\1 \5 \3');
    if v_new = v_def then raise exception 'pattern not found in %', f; end if;
    execute v_new;
  end loop;
end $$;
select lock_down_function_grants();
