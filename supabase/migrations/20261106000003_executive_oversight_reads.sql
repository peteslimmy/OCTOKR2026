-- Executive Oversight, part 3 of 3: read models. Every read function is SECURITY INVOKER: the caller's own row-level security decides which rows exist for them,
-- so the register, the dashboard figures, the contextual panel and the exports can never show more than the person may read. Counts are counted, never typed in.

create or replace function eo_person_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = p_user;
$$;
create or replace function eo_bu_name(p_bu uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$ select name from business_units where id = p_bu; $$;
create or replace function eo_user_active(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$ select coalesce((select status = 'ACTIVE' from users where id = p_user), false); $$;
create or replace function eo_quarter_label(p_quarter uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$ select 'Q' || quarter_number || ' ' || year from quarters where id = p_quarter; $$;
create or replace function eo_week_label(p_week uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$ select 'Week ' || week_number || ' ' || week_year from reporting_weeks where id = p_week; $$;

-- A response is overdue when one was asked for by a date that has passed, the unit has not yet decided, and it is not waiting for the Executive to answer a question first.
create or replace function eo_is_overdue(r eo_recommendations, t eo_rec_targets) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select r.status = 'ACTIVE' and r.response_requested and r.response_due is not null and r.response_due < (app_now() at time zone 'Africa/Lagos')::date
     and t.status in ('SUBMITTED','ACKNOWLEDGED','RESPONSE_REQUESTED','UNDER_CONSIDERATION') and coalesce(t.awaiting, 'BU') = 'BU';
$$;

create or replace function eo_comment_json(c eo_comments) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id', c.id, 'reference', c.reference, 'title', c.title, 'summary', left(c.content, 200), 'content', c.content,
    'category_code', (select code from eo_categories where id = c.category_id), 'category', (select name from eo_categories where id = c.category_id),
    'author_id', c.author_id, 'author_name', eo_person_name(c.author_id), 'author_role', c.author_role,
    'business_unit_id', c.business_unit_id, 'business_unit_name', coalesce(eo_bu_name(c.business_unit_id), 'Organisation-wide'), 'module', c.module,
    'subject_type', c.subject_type, 'subject_id', c.subject_id, 'subject_label', c.subject_label,
    'quarter_id', c.quarter_id, 'quarter', eo_quarter_label(c.quarter_id), 'reporting_week_id', c.reporting_week_id, 'week', eo_week_label(c.reporting_week_id),
    'visibility', c.visibility, 'status', c.status, 'version', c.version, 'created_at', c.created_at, 'amended_at', c.amended_at, 'last_activity_at', c.last_activity_at,
    'withdrawn_reason', c.withdrawn_reason,
    'replies', (select count(*) from eo_events e where e.comment_id = c.id and e.event_type = 'REPLY'),
    'attachments', (select count(*) from eo_attachments a where a.comment_id = c.id and a.deleted_at is null),
    'links', (select count(*) from eo_links l where l.comment_id = c.id and l.removed_at is null));
$$;

create or replace function eo_rec_json(r eo_recommendations, t eo_rec_targets) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id', r.id, 'target_id', t.id, 'reference', r.reference, 'title', r.title, 'priority', r.priority, 'rec_status', r.status,
    'status', case when r.status = 'DRAFT' then 'DRAFT' else t.status end, 'awaiting', t.awaiting, 'decision', t.decision, 'overdue', eo_is_overdue(r, t),
    'category_code', (select code from eo_categories where id = r.category_id), 'category', (select name from eo_categories where id = r.category_id),
    'author_id', r.author_id, 'author_name', eo_person_name(r.author_id), 'author_role', r.author_role,
    'business_unit_id', t.business_unit_id, 'business_unit_name', eo_bu_name(t.business_unit_id), 'module', r.module,
    'subject_type', r.subject_type, 'subject_id', r.subject_id, 'subject_label', r.subject_label,
    'quarter_id', r.quarter_id, 'quarter', eo_quarter_label(r.quarter_id), 'reporting_week_id', r.reporting_week_id, 'week', eo_week_label(r.reporting_week_id),
    'issued_at', coalesce(r.published_at, r.created_at), 'response_requested', r.response_requested, 'response_due', r.response_due,
    'responsible_user_id', t.responsible_user_id, 'responsible_name', eo_person_name(t.responsible_user_id), 'responsible_unavailable', t.responsible_user_id is not null and not eo_user_active(t.responsible_user_id),
    'escalation_level', t.escalation_level, 'closed_without_response', t.closed_without_response, 'version', r.version, 'target_version', t.version,
    'last_activity_at', greatest(r.last_activity_at, t.last_activity_at),
    'latest_update', (select jsonb_build_object('event_type', e.event_type, 'occurred_at', e.occurred_at, 'actor_name', eo_person_name(e.actor_id), 'excerpt', left(coalesce(e.body, ''), 160))
                      from eo_events e where e.recommendation_id = r.id and (e.target_id = t.id or e.target_id is null) and e.event_type not in ('LINK_ADDED','LINK_REMOVED','ATTACHMENT_ADDED','ATTACHMENT_REMOVED','DRAFT_CREATED')
                      order by e.seq desc limit 1),
    'attachments', (select count(*) from eo_attachments a where a.recommendation_id = r.id and a.deleted_at is null and (a.target_id is null or a.target_id = t.id)),
    'links', (select count(*) from eo_links l where l.recommendation_id = r.id and l.removed_at is null));
$$;

-- ------------------------------------------------------------------ comment register
create or replace function read_eo_comments(
  p_q text, p_bu uuid, p_quarter uuid, p_week uuid, p_from date, p_to date, p_category text, p_module text, p_author uuid, p_subject_type text, p_subject_id uuid, p_status text, p_limit int, p_offset int
) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_total int; v_rows jsonb; v_tsq tsquery := case when nullif(btrim(coalesce(p_q, '')), '') is null then null else websearch_to_tsquery('english', p_q) end;
begin
  select count(*) into v_total from eo_comments c
   where (v_tsq is null or c.search @@ v_tsq or c.reference ilike '%' || p_q || '%' or c.content ilike '%' || p_q || '%')
     and (p_bu is null or c.business_unit_id = p_bu) and (p_quarter is null or c.quarter_id = p_quarter) and (p_week is null or c.reporting_week_id = p_week)
     and (p_from is null or c.created_at >= p_from::timestamptz) and (p_to is null or c.created_at < (p_to + 1)::timestamptz)
     and (p_category is null or c.category_id = (select id from eo_categories where code = p_category)) and (p_module is null or c.module = p_module)
     and (p_author is null or c.author_id = p_author) and (p_status is null or c.status = p_status)
     and (p_subject_type is null or (c.subject_type = p_subject_type and c.subject_id = p_subject_id)
          or exists (select 1 from eo_links l where l.comment_id = c.id and l.target_type = p_subject_type and l.target_id = p_subject_id and l.removed_at is null));
  select coalesce(jsonb_agg(eo_comment_json(c) order by c.last_activity_at desc), '[]'::jsonb) into v_rows from (
    select * from eo_comments c
     where (v_tsq is null or c.search @@ v_tsq or c.reference ilike '%' || p_q || '%' or c.content ilike '%' || p_q || '%')
       and (p_bu is null or c.business_unit_id = p_bu) and (p_quarter is null or c.quarter_id = p_quarter) and (p_week is null or c.reporting_week_id = p_week)
       and (p_from is null or c.created_at >= p_from::timestamptz) and (p_to is null or c.created_at < (p_to + 1)::timestamptz)
       and (p_category is null or c.category_id = (select id from eo_categories where code = p_category)) and (p_module is null or c.module = p_module)
       and (p_author is null or c.author_id = p_author) and (p_status is null or c.status = p_status)
       and (p_subject_type is null or (c.subject_type = p_subject_type and c.subject_id = p_subject_id)
            or exists (select 1 from eo_links l where l.comment_id = c.id and l.target_type = p_subject_type and l.target_id = p_subject_id and l.removed_at is null))
     order by c.last_activity_at desc limit least(coalesce(p_limit, 25), 500) offset greatest(coalesce(p_offset, 0), 0)) c;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- ------------------------------------------------------------------ recommendation register (one line per addressed unit)
create or replace function read_eo_recommendations(
  p_q text, p_bu uuid, p_quarter uuid, p_week uuid, p_from date, p_to date, p_priority text, p_status text, p_author uuid, p_category text, p_module text,
  p_overdue boolean, p_awaiting text, p_due_from date, p_due_to date, p_subject_type text, p_subject_id uuid, p_sort text, p_limit int, p_offset int
) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_total int; v_rows jsonb; v_tsq tsquery := case when nullif(btrim(coalesce(p_q, '')), '') is null then null else websearch_to_tsquery('english', p_q) end;
begin
  select count(*) into v_total from eo_rec_targets t join eo_recommendations r on r.id = t.recommendation_id
   where (v_tsq is null or r.search @@ v_tsq or r.reference ilike '%' || p_q || '%' or r.detail ilike '%' || p_q || '%')
     and (p_bu is null or t.business_unit_id = p_bu) and (p_quarter is null or r.quarter_id = p_quarter) and (p_week is null or r.reporting_week_id = p_week)
     and (p_from is null or coalesce(r.published_at, r.created_at) >= p_from::timestamptz) and (p_to is null or coalesce(r.published_at, r.created_at) < (p_to + 1)::timestamptz)
     and (p_priority is null or r.priority = p_priority) and (p_status is null or (case when r.status = 'DRAFT' then 'DRAFT' else t.status end) = p_status)
     and (p_author is null or r.author_id = p_author) and (p_category is null or r.category_id = (select id from eo_categories where code = p_category)) and (p_module is null or r.module = p_module)
     and (p_overdue is not true or eo_is_overdue(r, t)) and (p_awaiting is null or t.awaiting = p_awaiting)
     and (p_due_from is null or r.response_due >= p_due_from) and (p_due_to is null or r.response_due <= p_due_to)
     and (p_subject_type is null or (r.subject_type = p_subject_type and r.subject_id = p_subject_id)
          or exists (select 1 from eo_links l where l.recommendation_id = r.id and l.target_type = p_subject_type and l.target_id = p_subject_id and l.removed_at is null));
  select coalesce(jsonb_agg(row_json order by ord1 desc, ord2 desc, ord3 desc), '[]'::jsonb) into v_rows from (
    select eo_rec_json(r, t) row_json,
           case when coalesce(p_sort, 'priority') = 'priority' then (case when eo_is_overdue(r, t) then 1 else 0 end) else 0 end ord1,
           case coalesce(p_sort, 'priority') when 'priority' then (case r.priority when 'CRITICAL' then 4 when 'HIGH' then 3 when 'NORMAL' then 2 else 1 end)::numeric
                                              when 'due' then -extract(epoch from coalesce(r.response_due, date '2999-12-31'))::numeric else 0 end ord2,
           extract(epoch from greatest(r.last_activity_at, t.last_activity_at))::numeric ord3
      from eo_rec_targets t join eo_recommendations r on r.id = t.recommendation_id
     where (v_tsq is null or r.search @@ v_tsq or r.reference ilike '%' || p_q || '%' or r.detail ilike '%' || p_q || '%')
       and (p_bu is null or t.business_unit_id = p_bu) and (p_quarter is null or r.quarter_id = p_quarter) and (p_week is null or r.reporting_week_id = p_week)
       and (p_from is null or coalesce(r.published_at, r.created_at) >= p_from::timestamptz) and (p_to is null or coalesce(r.published_at, r.created_at) < (p_to + 1)::timestamptz)
       and (p_priority is null or r.priority = p_priority) and (p_status is null or (case when r.status = 'DRAFT' then 'DRAFT' else t.status end) = p_status)
       and (p_author is null or r.author_id = p_author) and (p_category is null or r.category_id = (select id from eo_categories where code = p_category)) and (p_module is null or r.module = p_module)
       and (p_overdue is not true or eo_is_overdue(r, t)) and (p_awaiting is null or t.awaiting = p_awaiting)
       and (p_due_from is null or r.response_due >= p_due_from) and (p_due_to is null or r.response_due <= p_due_to)
       and (p_subject_type is null or (r.subject_type = p_subject_type and r.subject_id = p_subject_id)
            or exists (select 1 from eo_links l where l.recommendation_id = r.id and l.target_type = p_subject_type and l.target_id = p_subject_id and l.removed_at is null))
     order by 2 desc, 3 desc, 4 desc
     limit least(coalesce(p_limit, 25), 500) offset greatest(coalesce(p_offset, 0), 0)) q(row_json, ord1, ord2, ord3);
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- ------------------------------------------------------------------ dashboard
create or replace function read_eo_dashboard(p_bu uuid, p_quarter uuid, p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with tx as materialized (
    select t.id tid, t.status tstatus, t.awaiting, t.business_unit_id bu, r.id rid, r.priority, r.response_due, r.author_id, eo_is_overdue(r, t) overdue, r.last_activity_at, t.escalation_level
      from eo_rec_targets t join eo_recommendations r on r.id = t.recommendation_id
     where r.status <> 'DRAFT' and (p_bu is null or t.business_unit_id = p_bu) and (p_quarter is null or r.quarter_id = p_quarter)
       and (p_from is null or r.published_at >= p_from::timestamptz) and (p_to is null or r.published_at < (p_to + 1)::timestamptz))
  select jsonb_build_object(
    'comments_total', (select count(*) from eo_comments c where (p_bu is null or c.business_unit_id = p_bu) and (p_quarter is null or c.quarter_id = p_quarter)
                       and (p_from is null or c.created_at >= p_from::timestamptz) and (p_to is null or c.created_at < (p_to + 1)::timestamptz)),
    'comments_by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', coalesce(k.name, 'No category'), 'count', n) order by n desc), '[]'::jsonb)
                             from (select c.category_id, count(*) n from eo_comments c where (p_bu is null or c.business_unit_id = p_bu) and (p_quarter is null or c.quarter_id = p_quarter)
                                   and (p_from is null or c.created_at >= p_from::timestamptz) and (p_to is null or c.created_at < (p_to + 1)::timestamptz) group by c.category_id) q left join eo_categories k on k.id = q.category_id),
    'recommendations_total', (select count(distinct rid) from tx),
    'recommendation_units_total', (select count(*) from tx),
    'awaiting_acknowledgement', (select count(*) from tx where tstatus = 'SUBMITTED'),
    'awaiting_response', (select count(*) from tx x join eo_recommendations r on r.id = x.rid where r.response_requested and x.tstatus in ('SUBMITTED','ACKNOWLEDGED','RESPONSE_REQUESTED','UNDER_CONSIDERATION') and coalesce(x.awaiting, 'BU') = 'BU'),
    'awaiting_executive', (select count(*) from tx where awaiting = 'EXECUTIVE'),
    'overdue', (select count(*) from tx where overdue),
    'accepted_for_action', (select count(*) from tx where tstatus in ('ACCEPTED_FOR_ACTION','PARTIALLY_ACCEPTED')),
    'declined', (select count(*) from tx where tstatus = 'NOT_ACCEPTED'),
    'under_implementation', (select count(*) from tx where tstatus = 'IMPLEMENTATION_IN_PROGRESS'),
    'implementation_reported', (select count(*) from tx where tstatus = 'IMPLEMENTATION_REPORTED'),
    'closed', (select count(*) from tx where tstatus = 'CLOSED'),
    'withdrawn', (select count(*) from tx where tstatus = 'WITHDRAWN'),
    'by_status', (select coalesce(jsonb_object_agg(tstatus, n), '{}'::jsonb) from (select tstatus, count(*) n from tx group by tstatus) q),
    'by_priority', (select coalesce(jsonb_object_agg(priority, n), '{}'::jsonb) from (select priority, count(*) n from tx where tstatus not in ('CLOSED','WITHDRAWN') group by priority) q),
    'by_unit', (select coalesce(jsonb_agg(jsonb_build_object('business_unit_id', bu, 'name', eo_bu_name(bu), 'open', open_n, 'overdue', od, 'total', n) order by od desc, open_n desc), '[]'::jsonb)
                from (select bu, count(*) n, count(*) filter (where tstatus not in ('CLOSED','WITHDRAWN')) open_n, count(*) filter (where overdue) od from tx group by bu) q),
    'escalated', (select count(*) from tx where escalation_level > 0 and tstatus not in ('CLOSED','WITHDRAWN')),
    'my_drafts', (select count(*) from eo_recommendations d where d.status = 'DRAFT' and d.author_id = auth.uid()),
    'recent_comments', (select coalesce(jsonb_agg(eo_comment_json(c)), '[]'::jsonb) from (select * from eo_comments c where (p_bu is null or c.business_unit_id = p_bu) and (p_quarter is null or c.quarter_id = p_quarter)
                        and (p_from is null or c.created_at >= p_from::timestamptz) and (p_to is null or c.created_at < (p_to + 1)::timestamptz) order by c.last_activity_at desc limit 8) c),
    'recent_recommendations', (select coalesce(jsonb_agg(eo_rec_json(rr, tt) order by x.act desc), '[]'::jsonb) from (select tid, rid, last_activity_at act from tx order by last_activity_at desc limit 8) x
                               join eo_rec_targets tt on tt.id = x.tid join eo_recommendations rr on rr.id = x.rid),
    'pending_responses', (select coalesce(jsonb_agg(eo_rec_json(rr, tt) order by x.od desc, x.due nulls last), '[]'::jsonb) from (
                          select tid, rid, overdue od, response_due due from tx where tstatus in ('SUBMITTED','ACKNOWLEDGED','RESPONSE_REQUESTED','UNDER_CONSIDERATION') and coalesce(awaiting, 'BU') = 'BU'
                          order by overdue desc, response_due nulls last limit 8) x join eo_rec_targets tt on tt.id = x.tid join eo_recommendations rr on rr.id = x.rid),
    'overdue_list', (select coalesce(jsonb_agg(eo_rec_json(rr, tt) order by x.due), '[]'::jsonb) from (select tid, rid, response_due due from tx where overdue order by response_due limit 8) x
                     join eo_rec_targets tt on tt.id = x.tid join eo_recommendations rr on rr.id = x.rid),
    'awaiting_executive_list', (select coalesce(jsonb_agg(eo_rec_json(rr, tt) order by x.act), '[]'::jsonb) from (select tid, rid, last_activity_at act from tx where awaiting = 'EXECUTIVE' order by last_activity_at limit 8) x
                     join eo_rec_targets tt on tt.id = x.tid join eo_recommendations rr on rr.id = x.rid));
$$;

-- the read helpers are called by signed-in people through the invoker read functions, so they must be executable by them (they return names/labels or rows the caller's RLS already filters)
do $$
declare v_def text; a text := '''auth_okr_session_visible'',';
begin
  v_def := pg_get_functiondef('lock_down_function_grants()'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'lock_down_function_grants changed'; end if;
  if position('eo_person_name' in v_def) > 0 then return; end if;
  execute replace(v_def, a, '''eo_person_name'',''eo_bu_name'',''eo_user_active'',''eo_quarter_label'',''eo_week_label'',''eo_is_overdue'',''eo_comment_json'',''eo_rec_json'',' || a);
end $$;

-- ------------------------------------------------------------------ one comment with its whole history
create or replace function read_eo_comment(p_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select eo_comment_json(c) || jsonb_build_object(
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'title', v.title, 'content', v.content, 'category', (select name from eo_categories where id = v.category_id), 'saved_at', v.saved_at,
                  'replaced_at', v.replaced_at, 'replaced_by', eo_person_name(v.replaced_by), 'change_kind', v.change_kind, 'reason', v.reason) order by v.version), '[]'::jsonb) from eo_comment_versions v where v.comment_id = c.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'seq', e.seq, 'event_type', e.event_type, 'actor_id', e.actor_id, 'actor_name', eo_person_name(e.actor_id), 'actor_role', e.actor_role,
                  'body', e.body, 'details', e.details, 'occurred_at', e.occurred_at) order by e.seq), '[]'::jsonb) from eo_events e where e.comment_id = c.id),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'target_type', l.target_type, 'target_id', l.target_id, 'label', l.label, 'target_bu_id', l.target_bu_id) order by l.created_at), '[]'::jsonb)
              from eo_links l where l.comment_id = c.id and l.removed_at is null),
    'attachments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'uploaded_by', eo_person_name(a.uploaded_by), 'uploaded_by_id', a.uploaded_by, 'uploaded_at', a.uploaded_at) order by a.uploaded_at), '[]'::jsonb)
                    from eo_attachments a where a.comment_id = c.id and a.deleted_at is null))
  from eo_comments c where c.id = p_id;
$$;

-- ------------------------------------------------------------------ one recommendation with its whole history (a unit's person sees only their own unit's record and the common timeline)
create or replace function read_eo_recommendation(p_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', r.id, 'reference', r.reference, 'title', r.title, 'detail', r.detail, 'background', r.background, 'reason', r.reason, 'expected_outcome', r.expected_outcome, 'proposed_direction', r.proposed_direction,
    'priority', r.priority, 'status', r.status, 'version', r.version, 'category_code', (select code from eo_categories where id = r.category_id), 'category', (select name from eo_categories where id = r.category_id),
    'author_id', r.author_id, 'author_name', eo_person_name(r.author_id), 'author_role', r.author_role, 'author_active', eo_user_active(r.author_id), 'module', r.module,
    'subject_type', r.subject_type, 'subject_id', r.subject_id, 'subject_label', r.subject_label,
    'quarter_id', r.quarter_id, 'quarter', eo_quarter_label(r.quarter_id), 'reporting_week_id', r.reporting_week_id, 'week', eo_week_label(r.reporting_week_id),
    'recommended_owner_role', r.recommended_owner_role, 'recommended_owner_user', r.recommended_owner_user, 'recommended_owner_name', eo_person_name(r.recommended_owner_user),
    'response_requested', r.response_requested, 'response_due', r.response_due, 'created_at', r.created_at, 'published_at', r.published_at, 'withdrawn_at', r.withdrawn_at, 'withdrawn_reason', r.withdrawn_reason,
    'targets', (select coalesce(jsonb_agg(eo_rec_json(r, t) || jsonb_build_object('acknowledged_at', t.acknowledged_at, 'acknowledged_by', eo_person_name(t.acknowledged_by), 'responded_at', t.responded_at,
                 'closed_at', t.closed_at, 'closed_by', eo_person_name(t.closed_by), 'close_reason', t.close_reason, 'business_unit_active', coalesce((select status = 'ACTIVE' from business_units b where b.id = t.business_unit_id), false))
                 order by eo_bu_name(t.business_unit_id)), '[]'::jsonb) from eo_rec_targets t where t.recommendation_id = r.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'seq', e.seq, 'target_id', e.target_id, 'target_unit', eo_bu_name((select business_unit_id from eo_rec_targets where id = e.target_id)), 'event_type', e.event_type,
                  'actor_id', e.actor_id, 'actor_name', eo_person_name(e.actor_id), 'actor_role', e.actor_role, 'body', e.body, 'details', e.details, 'occurred_at', e.occurred_at) order by e.seq), '[]'::jsonb)
               from eo_events e where e.recommendation_id = r.id),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'target_type', l.target_type, 'target_id', l.target_id, 'label', l.label, 'target_bu_id', l.target_bu_id, 'added_by', eo_person_name(l.created_by)) order by l.created_at), '[]'::jsonb)
              from eo_links l where l.recommendation_id = r.id and l.removed_at is null),
    'attachments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'target_id', a.target_id, 'uploaded_by', eo_person_name(a.uploaded_by),
                    'uploaded_by_id', a.uploaded_by, 'uploaded_at', a.uploaded_at) order by a.uploaded_at), '[]'::jsonb) from eo_attachments a where a.recommendation_id = r.id and a.deleted_at is null))
  from eo_recommendations r where r.id = p_id;
$$;

-- ------------------------------------------------------------------ the side panel on any screen: what has been said about this record (directly, or through a link)
create or replace function read_eo_context(p_subject_type text, p_subject_id uuid, p_bu uuid, p_module text) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'comments', (select coalesce(jsonb_agg(eo_comment_json(c) order by c.last_activity_at desc), '[]'::jsonb) from (
        select * from eo_comments c
         where (p_bu is null or c.business_unit_id = p_bu or c.business_unit_id is null)
           and (case when p_subject_type is null then c.subject_type is null and c.module = coalesce(p_module, c.module)
                     else (c.subject_type = p_subject_type and c.subject_id = p_subject_id)
                          or exists (select 1 from eo_links l where l.comment_id = c.id and l.target_type = p_subject_type and l.target_id = p_subject_id and l.removed_at is null) end)
         order by c.last_activity_at desc limit 30) c),
    'recommendations', (select coalesce(jsonb_agg(eo_rec_json(r, t) order by greatest(r.last_activity_at, t.last_activity_at) desc), '[]'::jsonb) from eo_rec_targets t join eo_recommendations r on r.id = t.recommendation_id
         where r.status <> 'DRAFT' and (p_bu is null or t.business_unit_id = p_bu)
           and (case when p_subject_type is null then r.subject_type is null and r.module = coalesce(p_module, r.module)
                     else (r.subject_type = p_subject_type and r.subject_id = p_subject_id)
                          or exists (select 1 from eo_links l where l.recommendation_id = r.id and l.target_type = p_subject_type and l.target_id = p_subject_id and l.removed_at is null) end)));
$$;

-- what can be linked: the OKR components of the unit/week (as the Session Notes picker) and the unit's sessions, notes, decisions, actions and risks the caller may read
create or replace function read_eo_link_options(p_bu uuid, p_week uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select read_okr_link_options(p_bu, p_week) || jsonb_build_object(
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('type', 'SESSION', 'id', s.id, 'label', s.reference || ': ' || s.title || ' (' || to_char(s.session_date, 'DD Mon YYYY') || ')') order by s.session_date desc), '[]'::jsonb)
                 from (select * from okr_sessions where business_unit_id = p_bu and status <> 'ARCHIVED' order by session_date desc limit 25) s),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('type', 'SESSION_NOTE', 'id', n.id, 'label', 'Note: ' || coalesce(n.title, left(n.content, 70)), 'session_id', n.session_id) order by n.updated_at desc), '[]'::jsonb)
              from (select n.* from okr_session_notes n join okr_sessions s on s.id = n.session_id where s.business_unit_id = p_bu and n.status = 'ACTIVE' order by n.updated_at desc limit 40) n),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('type', 'SESSION_DECISION', 'id', d.id, 'label', d.reference || ': ' || d.title, 'session_id', d.session_id) order by d.created_at desc), '[]'::jsonb)
                  from (select d.* from okr_session_decisions d join okr_sessions s on s.id = d.session_id where s.business_unit_id = p_bu order by d.created_at desc limit 40) d),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object('type', 'SESSION_ACTION', 'id', a.id, 'label', a.reference || ': ' || left(a.description, 80)) order by a.created_at desc), '[]'::jsonb)
                from (select * from okr_session_actions where business_unit_id = p_bu order by created_at desc limit 40) a),
    'risks', (select coalesce(jsonb_agg(jsonb_build_object('type', 'SESSION_RISK', 'id', x.id, 'label', x.reference || ': ' || x.title) order by x.created_at desc), '[]'::jsonb)
              from (select * from okr_session_risks where business_unit_id = p_bu order by created_at desc limit 40) x));
$$;

select lock_down_function_grants();
