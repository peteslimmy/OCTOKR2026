-- A rejected report notifies the BU Leads of that business unit (the reason is in the message and the audit entry).
create or replace function reject_weekly_report(p_actor uuid, p_report_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_at timestamptz;
begin
  perform require_permission(p_actor, 'weekly_report.review');
  if v_reason is null then raise exception 'VALIDATION_FAILED' using detail = 'a rejection reason is required'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_FAILED' using detail = 'the rejection reason is limited to 2000 characters'; end if;
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if report_phase(v_r.reporting_week_id) <> 'FINAL_LOCKED' then raise exception 'REPORT_NOT_FINALISED' using detail = 'Reports are reviewed after final lock'; end if;
  if v_r.submission_status <> 'SUBMITTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'only submitted reports are reviewed'; end if;
  if v_r.review_status = 'REVIEWED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'a reviewed report cannot be rejected'; end if;
  v_at := app_now();
  update weekly_reports set review_rejection_reason = v_reason, rejected_at = v_at, rejected_by = p_actor where id = p_report_id;
  perform write_audit(p_actor, 'REPORT_REJECTED', 'weekly_report', p_report_id::text,
    jsonb_build_object('review_status', 'NOT_REVIEWED', 'review_rejection_reason', v_r.review_rejection_reason),
    jsonb_build_object('review_status', 'NOT_REVIEWED', 'review_rejection_reason', v_reason), v_reason, v_r.business_unit_id);
  perform notify_users(bu_lead_ids(v_r.business_unit_id), 'REPORT_REJECTED', 'weekly_report', p_report_id::text, 'Weekly report rejected',
    'Your finalised report was rejected by a reviewer: ' || v_reason, 'report-rejected:' || p_report_id::text || ':' || extract(epoch from v_at)::text);
end $$;

select lock_down_function_grants();
