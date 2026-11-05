-- The fund summary checks the permission itself, then adds up the whole ledger. Run as the caller it only added up the rows that person may read,
-- so a person who may see the fund but not the ledger (HR) saw zeros and a false "reconciliation mismatch". It now runs with the owner's rights.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('read_fund_summary()'::regprocedure);
  if position('STABLE' in v_def) = 0 then raise exception 'read_fund_summary changed'; end if;
  execute replace(v_def, E'STABLE\n', E'STABLE SECURITY DEFINER\n');
end $$;
select lock_down_function_grants();
