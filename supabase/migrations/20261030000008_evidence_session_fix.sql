-- Attaching evidence to a governance session has always failed: the SESSION branch of ops_upsert_evidence_file ran a bare
-- "select 1 from governance_sessions ..." which PL/pgSQL rejects ("query has no destination for result data"). Found by the generated
-- authorisation sweep and a per-entity-type test. The fix is PERFORM; the rest of the function is untouched.
do $$
declare v_def text; v_old text := 'select 1 from governance_sessions where id = p_entity_id;'; v_new text := 'perform 1 from governance_sessions where id = p_entity_id;';
begin
  v_def := pg_get_functiondef('ops_upsert_evidence_file(uuid,text,uuid,text,text,text,bigint,text)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'ops_upsert_evidence_file no longer contains the expected statement'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

select lock_down_function_grants();
