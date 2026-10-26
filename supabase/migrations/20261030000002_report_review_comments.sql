-- Review comments and rejection for finalised weekly reports.
-- A rejection is a review event, not a new review_status: the report stays NOT_REVIEWED, so it still counts as
-- awaiting review (ADR-081: the quarter stays PROVISIONAL) and the score is untouched. A later review clears the
-- rejection from the report view; every event stays in the audit trail.

alter table weekly_reports
  add column review_comments         text,
  add column review_rejection_reason text,
  add column rejected_at             timestamptz,
  add column rejected_by             uuid references users(id),
  add constraint weekly_reports_rejection_complete check (
    (review_rejection_reason is null) = (rejected_at is null) and (rejected_at is null) = (rejected_by is null)),
  add constraint weekly_reports_review_text_len check (
    char_length(coalesce(review_comments, '')) <= 2000 and char_length(coalesce(review_rejection_reason, '')) <= 2000);

-- Final-locked reports stay immutable except the review stamp, which now includes the review columns.
create or replace function guard_weekly_report() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'weekly reports are never deleted'; end if;
  if old.status = 'FINAL_LOCKED' then
    if new.status = 'OPEN' and coalesce(current_setting('app.late_exception', true), '') = 'on'
       and old.submission_status = 'NOT_SUBMITTED' and new.submission_status = 'NOT_SUBMITTED' and new.late_exception_id is not null then
      return new;
    end if;
    if (new.review_status, new.reviewed_at, new.reviewed_by, new.review_comments, new.review_rejection_reason, new.rejected_at, new.rejected_by)
       is distinct from
       (old.review_status, old.reviewed_at, old.reviewed_by, old.review_comments, old.review_rejection_reason, old.rejected_at, old.rejected_by) then
      if (new.id, new.business_unit_id, new.reporting_week_id, new.status, new.submission_status, new.version, new.submitted_at,
          new.skipped_session_summary_comment, new.final_locked_at, new.content_locked_at)
         is not distinct from
         (old.id, old.business_unit_id, old.reporting_week_id, old.status, old.submission_status, old.version, old.submitted_at,
          old.skipped_session_summary_comment, old.final_locked_at, old.content_locked_at) then
        return new;
      end if;
    end if;
    raise exception 'REPORT_FINAL_LOCKED';
  end if;
  if new.late_exception_id is distinct from old.late_exception_id then
    raise exception 'IMMUTABLE_RECORD' using detail = 'late_exception_id is set once, by the authorised path';
  end if;
  return new;
end $$;

-- review now takes optional comments (the two-argument call still works)
drop function review_weekly_report(uuid, uuid);
create or replace function review_weekly_report(p_actor uuid, p_report_id uuid, p_comments text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports; v_comments text := nullif(btrim(coalesce(p_comments, '')), '');
begin
  perform require_permission(p_actor, 'weekly_report.review');
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if report_phase(v_r.reporting_week_id) <> 'FINAL_LOCKED' then raise exception 'REPORT_NOT_FINALISED' using detail = 'Reports are reviewed after final lock'; end if;
  if v_r.submission_status <> 'SUBMITTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'only submitted reports are reviewed'; end if;
  if v_r.review_status = 'REVIEWED' then return; end if;
  if char_length(coalesce(v_comments, '')) > 2000 then raise exception 'VALIDATION_FAILED' using detail = 'review comments are limited to 2000 characters'; end if;
  update weekly_reports set review_status = 'REVIEWED', reviewed_at = app_now(), reviewed_by = p_actor, review_comments = v_comments,
    review_rejection_reason = null, rejected_at = null, rejected_by = null
    where id = p_report_id;
  perform write_audit(p_actor, 'REPORT_REVIEWED', 'weekly_report', p_report_id::text,
    jsonb_build_object('review_status', 'NOT_REVIEWED', 'review_rejection_reason', v_r.review_rejection_reason),
    jsonb_build_object('review_status', 'REVIEWED', 'review_comments', v_comments), null, v_r.business_unit_id);
  if v_r.late_exception_id is not null then
    insert into late_report_exception_events (exception_id, event_type, actor_user_id) values (v_r.late_exception_id, 'REVIEWED', p_actor);
  end if;
end $$;

-- reject: a reason is mandatory; the report keeps its score and stays awaiting review
create or replace function reject_weekly_report(p_actor uuid, p_report_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'weekly_report.review');
  if v_reason is null then raise exception 'VALIDATION_FAILED' using detail = 'a rejection reason is required'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_FAILED' using detail = 'the rejection reason is limited to 2000 characters'; end if;
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if report_phase(v_r.reporting_week_id) <> 'FINAL_LOCKED' then raise exception 'REPORT_NOT_FINALISED' using detail = 'Reports are reviewed after final lock'; end if;
  if v_r.submission_status <> 'SUBMITTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'only submitted reports are reviewed'; end if;
  if v_r.review_status = 'REVIEWED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'a reviewed report cannot be rejected'; end if;
  update weekly_reports set review_rejection_reason = v_reason, rejected_at = app_now(), rejected_by = p_actor where id = p_report_id;
  perform write_audit(p_actor, 'REPORT_REJECTED', 'weekly_report', p_report_id::text,
    jsonb_build_object('review_status', 'NOT_REVIEWED', 'review_rejection_reason', v_r.review_rejection_reason),
    jsonb_build_object('review_status', 'NOT_REVIEWED', 'review_rejection_reason', v_reason), v_reason, v_r.business_unit_id);
end $$;

-- report view: expose the review fields without rewriting the whole read model
alter function read_report_view(uuid) rename to read_report_view_base;
create or replace function read_report_view(p_report_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v jsonb; r weekly_reports;
begin
  v := read_report_view_base(p_report_id);
  if v is null then return null; end if;
  select * into r from weekly_reports where id = p_report_id;
  return jsonb_set(v, '{report}', (v->'report') || jsonb_build_object(
    'review_comments', r.review_comments, 'review_initiated_by', r.reviewed_by,
    'review_rejection_reason', r.review_rejection_reason, 'rejected_at', r.rejected_at));
end $$;

select lock_down_function_grants();
