-- Two-person approval for holiday amendments that change a closed week (owner decision 2, 14 October 2026; ADR-058).
-- Routine amendments (the week has not final-locked and its quarter is open) stay a single Admin step. When the week has final-locked
-- or its quarter is locked, an Admin REQUESTS the amendment and a DIFFERENT holder of quarter.score.amend approves or rejects it.
-- Approval applies the amendment in the same transaction through the unchanged amend_organization_holiday operation, so scoring,
-- versioning, compliance and audit behave exactly as before. Requests are append-only apart from their single decision.

create table holiday_amendment_requests (
  id               uuid primary key default gen_random_uuid(),
  reporting_week_id uuid not null references reporting_weeks(id) on delete restrict,
  direction        text not null check (direction in ('DECLARE','REVERSE')),
  reason           text not null check (btrim(reason) <> ''),
  status           text not null default 'PENDING' check (status in ('PENDING','APPLIED','REJECTED')),
  requested_by     uuid not null references users(id),
  idempotency_key  text not null unique,
  decided_by       uuid references users(id),
  decided_at       timestamptz,
  decision_comment text,
  decision_key     text unique,
  amendment_id     uuid references holiday_amendments(id) on delete restrict,
  created_at       timestamptz not null default app_now(),
  check ((status = 'PENDING') = (decided_by is null)),
  check (decided_by is null or decided_by <> requested_by),
  check (status <> 'REJECTED' or (decision_comment is not null and btrim(decision_comment) <> '')),
  check (status <> 'APPLIED' or amendment_id is not null)
);
create unique index holiday_amendment_requests_one_pending on holiday_amendment_requests (reporting_week_id) where status = 'PENDING';
create index holiday_amendment_requests_time_idx on holiday_amendment_requests (created_at desc);

create or replace function holiday_request_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'requests are never deleted'; end if;
  if old.status <> 'PENDING' then raise exception 'IMMUTABLE_RECORD' using detail = 'a decided request cannot change'; end if;
  if new.reporting_week_id <> old.reporting_week_id or new.direction <> old.direction or new.reason <> old.reason
     or new.requested_by <> old.requested_by or new.idempotency_key <> old.idempotency_key or new.created_at <> old.created_at then
    raise exception 'IMMUTABLE_RECORD' using detail = 'only the decision can be recorded';
  end if;
  return new;
end $$;
create trigger holiday_amendment_requests_guard before update or delete on holiday_amendment_requests for each row execute function holiday_request_guard();

-- ---------------------------------------------------------------- the amendment itself, with the new guard
create or replace function amend_organization_holiday(
  p_actor uuid, p_week_id uuid, p_direction text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_w reporting_weeks; v_prior text; v_new text; v_id uuid := gen_random_uuid(); v_final boolean; v_qlocked boolean; v_zeros int := 0;
  v_impact jsonb; v_audit uuid; v_existing holiday_amendments; r record; b record; v_snap uuid;
begin
  perform require_permission(p_actor, 'quarter.score.amend');
  if p_direction is null or p_direction not in ('DECLARE','REVERSE') then raise exception 'VALIDATION_ERROR' using detail = 'direction must be DECLARE or REVERSE'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_existing from holiday_amendments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.reporting_week_id <> p_week_id or v_existing.direction <> p_direction then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'amendment_id', v_existing.id, 'impact', v_existing.impact);
  end if;

  select * into v_w from reporting_weeks where id = p_week_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if app_now() >= v_w.final_lock_at and v_w.status <> 'FINAL_LOCKED' then raise exception 'FINAL_LOCK_PENDING' using detail = 'the week is still being finalised'; end if;
  v_prior := v_w.reporting_state;
  v_new := case p_direction when 'DECLARE' then 'ORGANIZATION_HOLIDAY' else 'NORMAL' end;
  if v_prior = v_new then raise exception 'INVALID_STATE_TRANSITION' using detail = 'week is already ' || v_prior; end if;
  if (p_direction = 'DECLARE') <> (v_prior = 'NORMAL') then raise exception 'INVALID_STATE_TRANSITION' using detail = p_direction || ' from ' || v_prior; end if;
  if exists (select 1 from late_report_exceptions where reporting_week_id = p_week_id and status in ('AUTHORISED','SUBMITTED')) then
    raise exception 'LATE_EXCEPTION_PENDING' using detail = 'resolve the late-report exception for this week first';
  end if;
  v_final := v_w.status = 'FINAL_LOCKED';
  v_qlocked := quarter_is_locked(v_w.quarter_id);

  -- An amendment that rewrites a closed week (final-locked, or in a locked quarter) changes compliance and quarterly scores for the
  -- record, so one Admin cannot do it alone: it must come through an independently approved request (ADR-058).
  if (v_final or v_qlocked) and coalesce(current_setting('app.holiday_request_approved', true), 'off') <> 'on' then
    raise exception 'TWO_PERSON_APPROVAL_REQUIRED' using detail = 'request the amendment; a different Admin must approve it';
  end if;

  perform set_config('app.holiday_declaration', 'on', true);
  update reporting_weeks set reporting_state = v_new where id = p_week_id;
  perform set_config('app.holiday_declaration', 'off', true);

  -- Reversing a holiday on a week that already final-locked makes it reportable retroactively: every expected BU that has no
  -- score yet gets its (submitted) score or a missing-report zero, exactly as final lock would have produced. Existing rows are kept.
  if p_direction = 'REVERSE' and v_final then
    for r in select * from weekly_reports where reporting_week_id = p_week_id loop
      if not exists (select 1 from weekly_score_snapshots where business_unit_id = r.business_unit_id and reporting_week_id = p_week_id) then
        v_snap := create_weekly_snapshot(r.business_unit_id, p_week_id, r.id, 'HOLIDAY_REVERSAL');
        if r.submission_status <> 'SUBMITTED' then v_zeros := v_zeros + 1; end if;
      end if;
      insert into weekly_compliance (business_unit_id, reporting_week_id, weekly_report_id, status, reason)
        values (r.business_unit_id, p_week_id, r.id, case when r.submission_status = 'SUBMITTED' then 'COMPLIANT' else 'NON_COMPLIANT' end,
                case when r.submission_status = 'SUBMITTED' then 'REPORT_SUBMITTED' else 'NOT_SUBMITTED_AT_FINAL_LOCK' end)
        on conflict do nothing;
    end loop;
    for b in select id from business_units where status = 'ACTIVE' and reports_weekly and created_at < v_w.week_end_at
             and not exists (select 1 from weekly_reports x where x.business_unit_id = business_units.id and x.reporting_week_id = p_week_id) loop
      if not exists (select 1 from weekly_score_snapshots where business_unit_id = b.id and reporting_week_id = p_week_id) then
        perform create_weekly_snapshot(b.id, p_week_id, null, 'HOLIDAY_REVERSAL');
        v_zeros := v_zeros + 1;
      end if;
      insert into weekly_compliance (business_unit_id, reporting_week_id, weekly_report_id, status, reason)
        values (b.id, p_week_id, null, 'NON_COMPLIANT', 'NO_REPORT_AT_FINAL_LOCK') on conflict do nothing;
    end loop;
  end if;

  insert into reporting_week_state_events (reporting_week_id, prior_state, new_state, reason, actor_user_id, idempotency_key)
    values (p_week_id, v_prior, v_new, btrim(p_reason), p_actor, p_idempotency_key);

  v_impact := snapshot_quarterly_scores_amended(v_w.quarter_id, v_id);
  v_audit := write_audit(p_actor, case p_direction when 'DECLARE' then 'ORGANIZATION_HOLIDAY_AMENDED_IN' else 'ORGANIZATION_HOLIDAY_REVERSED' end,
    'reporting_week', p_week_id::text, jsonb_build_object('state', v_prior),
    jsonb_build_object('state', v_new, 'week_final_locked', v_final, 'quarter_locked', v_qlocked, 'amendment_id', v_id,
                       'backfilled_zero_count', v_zeros, 'affected_business_units', jsonb_array_length(v_impact)),
    btrim(p_reason));
  insert into holiday_amendments (id, reporting_week_id, direction, prior_state, new_state, reason, actor_user_id, week_final_locked,
                                  quarter_locked, backfilled_zero_count, impact, idempotency_key, audit_id)
    values (v_id, p_week_id, p_direction, v_prior, v_new, btrim(p_reason), p_actor, v_final, v_qlocked, v_zeros, v_impact, p_idempotency_key, v_audit);
  perform notify_users(users_with_role('BU_LEAD'), 'ORGANIZATION_HOLIDAY_AMENDED', 'reporting_week', p_week_id::text,
    case p_direction when 'DECLARE' then 'Organisation holiday applied to a past week' else 'Organisation holiday reversed' end,
    case p_direction when 'DECLARE' then 'A reporting week is now an organisation holiday and is excluded from quarterly scores. Reason: ' || btrim(p_reason)
      else 'A reporting week is no longer an organisation holiday; it counts in quarterly scores again. Reason: ' || btrim(p_reason) end,
    'hol-am:' || v_id);
  return jsonb_build_object('replayed', false, 'amendment_id', v_id, 'direction', p_direction, 'week_final_locked', v_final,
    'quarter_locked', v_qlocked, 'backfilled_zero_count', v_zeros, 'impact', v_impact, 'audit_id', v_audit);
end $$;

-- ---------------------------------------------------------------- request
create or replace function request_holiday_amendment(
  p_actor uuid, p_week_id uuid, p_direction text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_w reporting_weeks; v_ex holiday_amendment_requests; v_id uuid; v_prior text;
begin
  perform require_permission(p_actor, 'quarter.score.amend');
  if p_direction is null or p_direction not in ('DECLARE','REVERSE') then raise exception 'VALIDATION_ERROR' using detail = 'direction must be DECLARE or REVERSE'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_ex from holiday_amendment_requests where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.reporting_week_id <> p_week_id or v_ex.direction <> p_direction or v_ex.requested_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_ex.id, 'status', v_ex.status);
  end if;
  select * into v_w from reporting_weeks where id = p_week_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (v_w.status = 'FINAL_LOCKED' or quarter_is_locked(v_w.quarter_id)) then
    raise exception 'HOLIDAY_REQUEST_NOT_NEEDED' using detail = 'this week is not closed: amend it directly';
  end if;
  v_prior := v_w.reporting_state;
  if (p_direction = 'DECLARE') <> (v_prior = 'NORMAL') then raise exception 'INVALID_STATE_TRANSITION' using detail = p_direction || ' from ' || v_prior; end if;
  if exists (select 1 from late_report_exceptions where reporting_week_id = p_week_id and status in ('AUTHORISED','SUBMITTED')) then
    raise exception 'LATE_EXCEPTION_PENDING' using detail = 'resolve the late-report exception for this week first';
  end if;
  if exists (select 1 from holiday_amendment_requests where reporting_week_id = p_week_id and status = 'PENDING') then
    raise exception 'HOLIDAY_REQUEST_PENDING' using detail = 'a request for this week is already waiting for a decision';
  end if;
  insert into holiday_amendment_requests (reporting_week_id, direction, reason, requested_by, idempotency_key)
    values (p_week_id, p_direction, btrim(p_reason), p_actor, p_idempotency_key) returning id into v_id;
  perform write_audit(p_actor, 'HOLIDAY_AMENDMENT_REQUESTED', 'holiday_amendment_request', v_id::text, null,
    jsonb_build_object('week_id', p_week_id, 'direction', p_direction), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission('quarter.score.amend'), p_actor), 'HOLIDAY_AMENDMENT_REQUESTED', 'holiday_amendment_request', v_id::text,
    'A holiday amendment needs your decision',
    'A change to a closed reporting week was requested and needs a second Admin to approve or reject it. Reason given: ' || btrim(p_reason),
    'hol-req:' || v_id);
  return jsonb_build_object('replayed', false, 'request_id', v_id, 'status', 'PENDING');
end $$;

-- ---------------------------------------------------------------- decision
create or replace function decide_holiday_amendment_request(
  p_actor uuid, p_request_id uuid, p_decision text, p_comment text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r holiday_amendment_requests; v_prev holiday_amendment_requests; v_out jsonb; v_amend uuid;
begin
  perform require_permission(p_actor, 'quarter.score.amend');
  if p_decision is null or p_decision not in ('APPROVE','REJECT') then raise exception 'VALIDATION_ERROR' using detail = 'decision must be APPROVE or REJECT'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_prev from holiday_amendment_requests where decision_key = p_idempotency_key;
  if found then
    if v_prev.id <> p_request_id or v_prev.decided_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_prev.id, 'status', v_prev.status, 'amendment_id', v_prev.amendment_id);
  end if;
  select * into v_r from holiday_amendment_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_r.status <> 'PENDING' then raise exception 'HOLIDAY_REQUEST_NOT_PENDING'; end if;
  if v_r.requested_by = p_actor then raise exception 'HOLIDAY_REQUEST_SELF_APPROVAL'; end if;

  if p_decision = 'REJECT' then
    if p_comment is null or btrim(p_comment) = '' then raise exception 'REASON_REQUIRED'; end if;
    update holiday_amendment_requests set status = 'REJECTED', decided_by = p_actor, decided_at = app_now(), decision_comment = btrim(p_comment), decision_key = p_idempotency_key
      where id = v_r.id;
    perform write_audit(p_actor, 'HOLIDAY_AMENDMENT_REJECTED', 'holiday_amendment_request', v_r.id::text, jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'REJECTED'), btrim(p_comment));
    perform notify_users(array[v_r.requested_by], 'HOLIDAY_AMENDMENT_REJECTED', 'holiday_amendment_request', v_r.id::text,
      'Your holiday amendment request was rejected', 'Reason: ' || btrim(p_comment), 'hol-req-rej:' || v_r.id);
    return jsonb_build_object('replayed', false, 'request_id', v_r.id, 'status', 'REJECTED');
  end if;

  perform set_config('app.holiday_request_approved', 'on', true);
  v_out := amend_organization_holiday(p_actor, v_r.reporting_week_id, v_r.direction, v_r.reason, 'req:' || v_r.id);
  perform set_config('app.holiday_request_approved', 'off', true);
  v_amend := (v_out->>'amendment_id')::uuid;
  update holiday_amendment_requests set status = 'APPLIED', decided_by = p_actor, decided_at = app_now(), decision_comment = nullif(btrim(coalesce(p_comment, '')), ''),
    decision_key = p_idempotency_key, amendment_id = v_amend where id = v_r.id;
  perform write_audit(p_actor, 'HOLIDAY_AMENDMENT_APPROVED', 'holiday_amendment_request', v_r.id::text, jsonb_build_object('status', 'PENDING'),
    jsonb_build_object('status', 'APPLIED', 'amendment_id', v_amend, 'requested_by', v_r.requested_by), nullif(btrim(coalesce(p_comment, '')), ''));
  perform notify_users(array[v_r.requested_by], 'HOLIDAY_AMENDMENT_APPROVED', 'holiday_amendment_request', v_r.id::text,
    'Your holiday amendment request was approved and applied', 'The change was applied and new quarterly score versions were created.', 'hol-req-ok:' || v_r.id);
  return v_out || jsonb_build_object('request_id', v_r.id, 'status', 'APPLIED');
end $$;

-- ---------------------------------------------------------------- read model + RLS
create or replace function read_holiday_amendment_requests() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'status', r.status, 'direction', r.direction, 'reason', r.reason, 'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'reporting_week_id', w.id, 'week_number', w.week_number, 'week_year', w.week_year, 'week_start_at', w.week_start_at,
    'requested_by_id', r.requested_by,
    'requested_by', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.requested_by),
    'decided_by', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.decided_by)
  ) order by r.created_at desc), '[]'::jsonb)
  from holiday_amendment_requests r join reporting_weeks w on w.id = r.reporting_week_id;
$$;

alter table holiday_amendment_requests enable row level security;
grant select on holiday_amendment_requests to authenticated;
create policy read_scoped on holiday_amendment_requests for select to authenticated using (auth_has_permission('quarter.score.amend'));

select lock_down_function_grants();
