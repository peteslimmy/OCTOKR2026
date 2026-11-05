-- Executive Oversight, part 2 of 3: the write functions (the only writers), links, attachments, configuration, follow-up job.
-- Every function re-checks permission, unit scope, state and version, writes the timeline and the audit in the same transaction, and is service-role only.
-- Nothing here writes to goals, tasks, reports, scores, attendance, violations, finance, strategy or compliance.

-- ------------------------------------------------------------------ helpers
create or replace function eo_role(p_actor uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$ select coalesce(array_to_string(actor_role_codes(p_actor), ','), ''); $$;

create or replace function eo_bu_leads(p_bu uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(u.id), '{}') from users u join employees e on e.id = u.employee_id
  where e.business_unit_id = p_bu and u.status = 'ACTIVE' and actor_has_permission(u.id, 'executive_recommendation.respond');
$$;

create or replace function eo_bu_viewers(p_bu uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(u.id), '{}') from users u join employees e on e.id = u.employee_id
  where e.business_unit_id = p_bu and u.status = 'ACTIVE' and actor_has_permission(u.id, 'executive_comment.view');
$$;

-- what a subject (the primary record a comment or recommendation is about) is called and which unit it belongs to
create or replace function eo_resolve_subject(p_type text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_type
    when 'BUSINESS_UNIT' then (select jsonb_build_object('label', 'Business unit: ' || name, 'bu', id) from business_units where id = p_id)
    when 'SESSION' then (select jsonb_build_object('label', 'Session ' || reference || ': ' || title, 'bu', business_unit_id) from okr_sessions where id = p_id)
    when 'SESSION_NOTE' then (select jsonb_build_object('label', 'Session note in ' || s.reference || ': ' || coalesce(n.title, left(n.content, 80)), 'bu', s.business_unit_id) from okr_session_notes n join okr_sessions s on s.id = n.session_id where n.id = p_id)
    when 'SESSION_DECISION' then (select jsonb_build_object('label', 'Decision ' || d.reference || ': ' || d.title, 'bu', s.business_unit_id) from okr_session_decisions d join okr_sessions s on s.id = d.session_id where d.id = p_id)
    when 'SESSION_ACTION' then (select jsonb_build_object('label', 'Action ' || a.reference || ': ' || left(a.description, 100), 'bu', a.business_unit_id) from okr_session_actions a where a.id = p_id)
    when 'SESSION_RISK' then (select jsonb_build_object('label', 'Risk ' || x.reference || ': ' || x.title, 'bu', x.business_unit_id) from okr_session_risks x where x.id = p_id)
    else okr_link_target(p_type, p_id) end;
end $$;

-- A person may reference only what they may already read, and only inside the units the item is addressed to. A reference never widens access.
create or replace function eo_assert_ref(p_actor uuid, p_type text, p_id uuid, p_bus uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t jsonb; v_bu uuid;
begin
  if p_type is null or p_id is null then raise exception 'LINK_TARGET_INVALID'; end if;
  t := eo_resolve_subject(p_type, p_id);
  if t is null then raise exception 'LINK_TARGET_INVALID' using detail = 'that record does not exist'; end if;
  v_bu := nullif(t ->> 'bu', '')::uuid;
  if p_type like 'SESSION%' and not eo_link_target_visible_to(p_actor, p_type, p_id) then
    raise exception 'LINK_TARGET_INVALID' using detail = 'that record does not exist';          -- same answer as a missing record: nothing is revealed
  end if;
  if v_bu is not null and not (v_bu = any(coalesce(p_bus, '{}'))) then
    raise exception 'LINK_TARGET_INVALID' using detail = 'that record belongs to a business unit this item is not about';
  end if;
  if v_bu is not null and p_type not like 'SESSION%' and not (actor_has_permission(p_actor, 'weekly_report.view_all') or (actor_has_permission(p_actor, 'weekly_report.view_own_bu') and v_bu = actor_bu(p_actor))) then
    raise exception 'BU_SCOPE_DENIED';
  end if;
  return t;
end $$;

-- the quarter that goes with a week (or a quarter given alone); a quarter that contradicts the week is refused
create or replace function eo_context(p_quarter uuid, p_week uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_q uuid := p_quarter; v_wq uuid;
begin
  if p_week is not null then
    select quarter_id into v_wq from reporting_weeks where id = p_week;
    if not found then raise exception 'VALIDATION_ERROR' using detail = 'that reporting week does not exist'; end if;
    if v_q is not null and v_q <> v_wq then raise exception 'VALIDATION_ERROR' using detail = 'that week is not in that quarter'; end if;
    v_q := v_wq;
  elsif v_q is not null and not exists (select 1 from quarters where id = v_q) then
    raise exception 'VALIDATION_ERROR' using detail = 'that quarter does not exist';
  end if;
  return v_q;
end $$;

-- the unit an actor may write about: every unit with view_all, otherwise their own and inside their unit scope
create or replace function eo_assert_writable_bu(p_actor uuid, p_bu uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from business_units where id = p_bu) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from business_units where id = p_bu and status = 'ACTIVE') then raise exception 'BU_INACTIVE' using detail = 'that business unit is archived; its history stays readable but new items cannot be addressed to it'; end if;
  if not actor_has_permission(p_actor, 'executive_oversight.view_all') and p_bu is distinct from actor_bu(p_actor) then raise exception 'BU_SCOPE_DENIED'; end if;
  perform assert_unit_scope(p_actor, p_bu);
end $$;

-- the single writer of the timeline; the audit log receives the same fact
create or replace function eo_log(p_actor uuid, p_comment uuid, p_rec uuid, p_target uuid, p_event text, p_body text default null, p_details jsonb default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_bu uuid;
begin
  insert into eo_events (comment_id, recommendation_id, target_id, event_type, actor_id, actor_role, body, details)
  values (p_comment, p_rec, p_target, p_event, p_actor, case when p_actor is null then null else eo_role(p_actor) end, p_body, p_details) returning id into v_id;
  if p_comment is not null then
    update eo_comments set last_activity_at = app_now() where id = p_comment;
    select business_unit_id into v_bu from eo_comments where id = p_comment;
  else
    update eo_recommendations set last_activity_at = app_now() where id = p_rec;
    if p_target is not null then update eo_rec_targets set last_activity_at = app_now() where id = p_target; end if;
    select business_unit_id into v_bu from eo_rec_targets where id = p_target;
  end if;
  perform write_audit(p_actor, 'EXEC_OVERSIGHT_' || p_event, case when p_comment is not null then 'eo_comment' else 'eo_recommendation' end, coalesce(p_comment, p_rec)::text, null,
                      coalesce(p_details, '{}'::jsonb) || jsonb_build_object('event_id', v_id, 'target_id', p_target), null, v_bu);
  return v_id;
end $$;

create or replace function eo_add_link(p_actor uuid, p_comment uuid, p_rec uuid, p_type text, p_id uuid, p_bus uuid[]) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t jsonb := eo_assert_ref(p_actor, p_type, p_id, p_bus); v_id uuid;
begin
  if p_type in ('BUSINESS_UNIT') then raise exception 'LINK_TARGET_INVALID' using detail = 'a business unit is a subject, not a link'; end if;
  insert into eo_links (comment_id, recommendation_id, target_type, target_id, label, target_bu_id, created_by)
  values (p_comment, p_rec, p_type, p_id, left(t ->> 'label', 300), nullif(t ->> 'bu', '')::uuid, p_actor)
  on conflict (coalesce(comment_id, recommendation_id), target_type, target_id) where removed_at is null do nothing returning id into v_id;
  if v_id is not null then perform eo_log(p_actor, p_comment, p_rec, null, 'LINK_ADDED', null, jsonb_build_object('target_type', p_type, 'target_id', p_id, 'label', left(t ->> 'label', 300))); end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------ comments
-- p_links: [{ "target_type": "SESSION_NOTE", "target_id": uuid }]
create or replace function create_eo_comment(
  p_actor uuid, p_bu uuid, p_category text, p_title text, p_content text, p_visibility text, p_module text,
  p_subject_type text, p_subject_id uuid, p_quarter uuid, p_week uuid, p_links jsonb, p_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; v_bu uuid := p_bu; t jsonb; v_cat uuid; v_id uuid; v_ref text; v_q uuid; v_vis text := coalesce(p_visibility, 'SHARED'); v_content text := okr_clean(p_content, 10000, 'the comment', true); x jsonb; v_res jsonb;
begin
  perform require_permission(p_actor, 'executive_comment.create');
  v_prev := okr_idem(p_actor, p_key, 'create_eo_comment'); if v_prev is not null then return v_prev; end if;
  if v_vis not in ('SHARED','MANAGEMENT') then raise exception 'VALIDATION_ERROR' using detail = 'unknown visibility'; end if;
  if p_module is null then raise exception 'VALIDATION_ERROR' using detail = 'the module the comment is about is required'; end if;
  if p_subject_type is not null then
    t := eo_resolve_subject(p_subject_type, p_subject_id);
    if t is null then raise exception 'LINK_TARGET_INVALID' using detail = 'that record does not exist'; end if;
    if v_bu is null then v_bu := nullif(t ->> 'bu', '')::uuid; end if;             -- the unit is inherited from the record being reviewed
    t := eo_assert_ref(p_actor, p_subject_type, p_subject_id, case when v_bu is null then '{}'::uuid[] else array[v_bu] end);
  end if;
  if v_bu is null then
    if not actor_has_permission(p_actor, 'executive_oversight.view_all') then raise exception 'BU_SCOPE_DENIED'; end if;
    v_vis := 'MANAGEMENT';
  else
    perform eo_assert_writable_bu(p_actor, v_bu);
  end if;
  if p_category is not null then select id into v_cat from eo_categories where code = p_category and active; if not found then raise exception 'VALIDATION_ERROR' using detail = 'unknown comment category'; end if; end if;
  v_q := eo_context(p_quarter, p_week);
  v_ref := okr_next_ref('EO_COMMENT', 'EOC', extract(year from okr_today_wat())::int);
  insert into eo_comments (reference, category_id, title, content, author_id, author_role, business_unit_id, module, subject_type, subject_id, subject_label, quarter_id, reporting_week_id, visibility)
  values (v_ref, v_cat, okr_clean(p_title, 200, 'the title'), v_content, p_actor, eo_role(p_actor), v_bu, p_module, p_subject_type, p_subject_id, left(t ->> 'label', 300), v_q, p_week, v_vis)
  returning id into v_id;
  for x in select * from jsonb_array_elements(okr_arr(p_links)) loop
    perform eo_add_link(p_actor, v_id, null, x ->> 'target_type', (x ->> 'target_id')::uuid, case when v_bu is null then '{}'::uuid[] else array[v_bu] end);
  end loop;
  perform eo_log(p_actor, v_id, null, null, 'CREATED', null, jsonb_build_object('reference', v_ref, 'category', p_category, 'module', p_module, 'visibility', v_vis, 'subject_type', p_subject_type, 'subject_id', p_subject_id));
  if v_vis = 'SHARED' then
    perform okr_notify(p_actor, eo_bu_viewers(v_bu), 'EO_COMMENT_NEW', 'eo_comment', v_id, 'Executive comment: ' || coalesce(okr_clean(p_title, 200, 'the title'), left(v_content, 80)),
                       left(v_content, 300), 'eo:' || v_id || ':new');
  end if;
  v_res := jsonb_build_object('id', v_id, 'reference', v_ref, 'version', 1, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

create or replace function reply_eo_comment(p_actor uuid, p_comment uuid, p_content text, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; c eo_comments; v_content text := okr_clean(p_content, 10000, 'the reply', true); v_ev uuid; v_to uuid[]; v_res jsonb;
begin
  perform require_permission(p_actor, 'executive_comment.reply');
  v_prev := okr_idem(p_actor, p_key, 'reply_eo_comment'); if v_prev is not null then return v_prev; end if;
  select * into c from eo_comments where id = p_comment for update;                      -- concurrent replies queue here, each one is kept in order
  if not found then raise exception 'NOT_FOUND'; end if;
  if not eo_comment_visible_to(p_actor, c.id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if c.status <> 'PUBLISHED' then raise exception 'COMMENT_WITHDRAWN' using detail = 'the author withdrew this comment; the conversation is closed'; end if;
  v_ev := eo_log(p_actor, c.id, null, null, 'REPLY', v_content, null);
  select coalesce(array_agg(distinct e.actor_id), '{}') into v_to from eo_events e where e.comment_id = c.id and e.event_type in ('REPLY','CREATED') and e.actor_id is not null and e.actor_id <> p_actor;
  v_to := array(select distinct x from unnest(v_to || c.author_id) x where x <> p_actor and eo_comment_visible_to(x, c.id));
  perform okr_notify(p_actor, v_to, 'EO_COMMENT_REPLY', 'eo_comment', c.id, 'Reply on ' || c.reference, left(v_content, 300), 'eo:' || v_ev || ':reply');
  v_res := jsonb_build_object('id', v_ev, 'comment_id', c.id, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- Amendment: the author only, with a reason; the earlier wording stays readable for everybody who can read the comment.
create or replace function amend_eo_comment(p_actor uuid, p_comment uuid, p_expected_version int, p_category text, p_title text, p_content text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c eo_comments; v_reason text := okr_clean(p_reason, 2000, 'the reason', true); v_cat uuid; v_content text; v_title text; v_replies int; v_to uuid[];
begin
  perform require_permission(p_actor, 'executive_comment.amend');
  if p_expected_version is null then raise exception 'VALIDATION_ERROR' using detail = 'the version you started from is required'; end if;
  select * into c from eo_comments where id = p_comment for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not eo_comment_visible_to(p_actor, c.id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if c.author_id <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the author can amend a comment'; end if;
  if c.status <> 'PUBLISHED' then raise exception 'COMMENT_WITHDRAWN'; end if;
  perform okr_check_version(p_expected_version, c.version);
  v_content := coalesce(okr_clean(p_content, 10000, 'the comment'), c.content);
  v_title := case when p_title is null then c.title else okr_clean(p_title, 200, 'the title') end;
  v_cat := c.category_id;
  if p_category is not null then select id into v_cat from eo_categories where code = p_category and active; if not found then raise exception 'VALIDATION_ERROR' using detail = 'unknown comment category'; end if; end if;
  if v_content = c.content and v_title is not distinct from c.title and v_cat is not distinct from c.category_id then return jsonb_build_object('id', c.id, 'version', c.version, 'unchanged', true); end if;
  insert into eo_comment_versions (comment_id, version, category_id, title, content, saved_at, replaced_by, change_kind, reason)
  values (c.id, c.version, c.category_id, c.title, c.content, coalesce(c.amended_at, c.created_at), p_actor, 'AMENDED', v_reason);
  update eo_comments set category_id = v_cat, title = v_title, content = v_content, version = version + 1, amended_at = app_now() where id = c.id;
  select count(*) into v_replies from eo_events where comment_id = c.id and event_type = 'REPLY';
  perform eo_log(p_actor, c.id, null, null, 'AMENDED', null, jsonb_build_object('from_version', c.version, 'replies_at_the_time', v_replies, 'reason', v_reason));
  select coalesce(array_agg(distinct e.actor_id), '{}') into v_to from eo_events e where e.comment_id = c.id and e.event_type = 'REPLY' and e.actor_id <> p_actor;
  perform okr_notify(p_actor, array(select x from unnest(v_to) x where eo_comment_visible_to(x, c.id)), 'EO_COMMENT_REPLY', 'eo_comment', c.id, c.reference || ' was amended', 'Reason: ' || left(v_reason, 250), 'eo:' || c.id || ':amend:' || (c.version + 1));
  return jsonb_build_object('id', c.id, 'version', c.version + 1);
end $$;

create or replace function withdraw_eo_comment(p_actor uuid, p_comment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c eo_comments; v_reason text := okr_clean(p_reason, 2000, 'the reason', true);
begin
  perform require_permission(p_actor, 'executive_comment.amend');
  select * into c from eo_comments where id = p_comment for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not eo_comment_visible_to(p_actor, c.id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if c.author_id <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the author can withdraw a comment'; end if;
  if c.status <> 'PUBLISHED' then raise exception 'INVALID_STATE_TRANSITION'; end if;
  insert into eo_comment_versions (comment_id, version, category_id, title, content, saved_at, replaced_by, change_kind, reason)
  values (c.id, c.version, c.category_id, c.title, c.content, coalesce(c.amended_at, c.created_at), p_actor, 'WITHDRAWN', v_reason);
  update eo_comments set status = 'WITHDRAWN', withdrawn_at = app_now(), withdrawn_reason = v_reason, version = version + 1 where id = c.id;
  perform eo_log(p_actor, c.id, null, null, 'WITHDRAWN', null, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('id', c.id, 'version', c.version + 1);
end $$;

-- ------------------------------------------------------------------ recommendations
-- Assigns the contact responsible in a unit: the person the author proposed (if in that unit), otherwise the unit's only BU Lead; otherwise nobody until one acknowledges.
create or replace function eo_default_contact(p_bu uuid, p_owner uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_leads uuid[];
begin
  if p_owner is not null and exists (select 1 from users u join employees e on e.id = u.employee_id where u.id = p_owner and u.status = 'ACTIVE' and e.business_unit_id = p_bu) then return p_owner; end if;
  v_leads := eo_bu_leads(p_bu);
  if cardinality(v_leads) = 1 then return v_leads[1]; end if;
  return null;
end $$;

create or replace function eo_publish(p_actor uuid, r eo_recommendations) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ref text := okr_next_ref('EO_REC', 'EOR', extract(year from okr_today_wat())::int); t record; v_urgent text := case r.priority when 'CRITICAL' then '[CRITICAL] ' when 'HIGH' then '[HIGH] ' else '' end;
begin
  update eo_recommendations set status = 'ACTIVE', reference = v_ref, published_at = app_now(), updated_at = app_now(), version = version + 1 where id = r.id;
  for t in select * from eo_rec_targets where recommendation_id = r.id loop
    update eo_rec_targets set status = 'SUBMITTED', awaiting = case when r.response_requested then 'BU' else null end,
           responsible_user_id = eo_default_contact(t.business_unit_id, r.recommended_owner_user), last_activity_at = app_now() where id = t.id;
  end loop;
  perform eo_log(p_actor, null, r.id, null, 'PUBLISHED', null, jsonb_build_object('reference', v_ref, 'priority', r.priority, 'response_requested', r.response_requested, 'response_due', r.response_due,
                 'units', (select jsonb_agg(b.name order by b.name) from eo_rec_targets x join business_units b on b.id = x.business_unit_id where x.recommendation_id = r.id)));
  for t in select x.id, x.business_unit_id from eo_rec_targets x where x.recommendation_id = r.id loop
    perform okr_notify(p_actor, array(select distinct y from unnest(eo_bu_leads(t.business_unit_id) || coalesce(eo_default_contact(t.business_unit_id, r.recommended_owner_user), '00000000-0000-0000-0000-000000000000'::uuid)) y where y <> '00000000-0000-0000-0000-000000000000'::uuid),
                       'EO_REC_NEW', 'eo_recommendation', r.id, v_urgent || 'Recommendation ' || v_ref || ': ' || r.title,
                       case when r.response_requested then 'Acknowledge it and respond' || coalesce(' by ' || to_char(r.response_due, 'DD Mon YYYY'), '') || '. ' else 'For your consideration. ' end || left(r.detail, 250),
                       'eo:' || r.id || ':pub:' || t.id);
  end loop;
  return v_ref;
end $$;

-- p_id null creates a draft; otherwise updates the author's draft. p_targets = the addressed business units; p_links = the full desired list of links.
create or replace function save_eo_recommendation(
  p_actor uuid, p_id uuid, p_expected_version int, p_title text, p_detail text, p_background text, p_reason text, p_outcome text, p_direction text, p_priority text,
  p_category text, p_module text, p_subject_type text, p_subject_id uuid, p_quarter uuid, p_week uuid, p_owner_role text, p_owner_user uuid,
  p_response_requested boolean, p_response_due date, p_targets uuid[], p_links jsonb, p_publish boolean, p_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; r eo_recommendations; v_id uuid; v_bus uuid[]; b uuid; t jsonb; v_cat uuid; v_q uuid; v_title text := okr_clean(p_title, 200, 'the title', true); v_detail text := okr_clean(p_detail, 10000, 'the recommendation', true);
  v_reason text := okr_clean(p_reason, 10000, 'the reason for the recommendation', coalesce(p_publish, false)); v_priority text := coalesce(p_priority, 'NORMAL'); v_req boolean := coalesce(p_response_requested, false); x jsonb; v_ref text; v_res jsonb; v_wanted uuid[];
begin
  perform require_permission(p_actor, 'executive_recommendation.create');
  v_prev := okr_idem(p_actor, p_key, 'save_eo_recommendation'); if v_prev is not null then return v_prev; end if;
  if v_priority not in ('LOW','NORMAL','HIGH','CRITICAL') then raise exception 'VALIDATION_ERROR' using detail = 'unknown priority'; end if;
  if p_module is null then raise exception 'VALIDATION_ERROR' using detail = 'the module the recommendation is about is required'; end if;
  v_bus := array(select distinct u from unnest(coalesce(p_targets, '{}')) u where u is not null);
  if cardinality(v_bus) = 0 then raise exception 'VALIDATION_ERROR' using detail = 'choose at least one business unit to address'; end if;
  foreach b in array v_bus loop perform eo_assert_writable_bu(p_actor, b); end loop;
  if p_response_due is not null and not v_req then raise exception 'VALIDATION_ERROR' using detail = 'a response deadline needs "response requested"'; end if;
  if p_response_due is not null and p_response_due < okr_today_wat() then raise exception 'VALIDATION_ERROR' using detail = 'the response deadline is in the past'; end if;
  if p_owner_user is not null and not exists (select 1 from users u join employees e on e.id = u.employee_id where u.id = p_owner_user and u.status = 'ACTIVE' and e.business_unit_id = any(v_bus)) then
    raise exception 'RECIPIENT_UNAVAILABLE' using detail = 'the recommended person is not an active member of an addressed unit';
  end if;
  if p_subject_type is not null then t := eo_assert_ref(p_actor, p_subject_type, p_subject_id, v_bus); end if;
  if p_category is not null then select id into v_cat from eo_categories where code = p_category and active; if not found then raise exception 'VALIDATION_ERROR' using detail = 'unknown category'; end if; end if;
  v_q := eo_context(p_quarter, p_week);
  if p_id is null then
    -- the same author sending the same recommendation to the same units again within minutes (a double click that lost its request key, a retry after a timeout) is refused
    if exists (select 1 from eo_recommendations d where d.author_id = p_actor and lower(d.title) = lower(v_title) and d.status in ('DRAFT','ACTIVE') and d.created_at > app_now() - interval '10 minutes'
                 and array(select business_unit_id from eo_rec_targets where recommendation_id = d.id order by 1) = array(select u from unnest(v_bus) u order by 1)) then
      raise exception 'DUPLICATE_RECOMMENDATION' using detail = 'you issued this recommendation to these units a moment ago';
    end if;
    insert into eo_recommendations (category_id, title, detail, background, reason, expected_outcome, proposed_direction, priority, author_id, author_role, module, subject_type, subject_id, subject_label,
                                    quarter_id, reporting_week_id, recommended_owner_role, recommended_owner_user, response_requested, response_due)
    values (v_cat, v_title, v_detail, okr_clean(p_background, 10000, 'the background'), v_reason, okr_clean(p_outcome, 5000, 'the expected outcome'), okr_clean(p_direction, 5000, 'the proposed direction'), v_priority,
            p_actor, eo_role(p_actor), p_module, p_subject_type, p_subject_id, left(t ->> 'label', 300), v_q, p_week, okr_clean(p_owner_role, 100, 'the recommended role'), p_owner_user, v_req, p_response_due)
    returning id into v_id;
    perform eo_log(p_actor, null, v_id, null, 'DRAFT_CREATED', null, jsonb_build_object('title', v_title, 'priority', v_priority));
  else
    select * into r from eo_recommendations where id = p_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if r.author_id <> p_actor then if eo_rec_visible_to(p_actor, r.id) then raise exception 'PERMISSION_DENIED' using detail = 'only the author can change a recommendation'; else raise exception 'BU_SCOPE_DENIED'; end if; end if;
    if r.status <> 'DRAFT' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'a published recommendation cannot be edited; withdraw it and issue a new one'; end if;
    perform okr_check_version(p_expected_version, r.version);
    v_id := r.id;
    update eo_recommendations set category_id = v_cat, title = v_title, detail = v_detail, background = okr_clean(p_background, 10000, 'the background'), reason = v_reason,
           expected_outcome = okr_clean(p_outcome, 5000, 'the expected outcome'), proposed_direction = okr_clean(p_direction, 5000, 'the proposed direction'), priority = v_priority, module = p_module,
           subject_type = p_subject_type, subject_id = p_subject_id, subject_label = left(t ->> 'label', 300), quarter_id = v_q, reporting_week_id = p_week,
           recommended_owner_role = okr_clean(p_owner_role, 100, 'the recommended role'), recommended_owner_user = p_owner_user, response_requested = v_req, response_due = p_response_due,
           version = version + 1, updated_at = app_now()
     where id = v_id;
  end if;
  -- addressed units of a draft
  delete from eo_rec_targets where recommendation_id = v_id and not (business_unit_id = any(v_bus));
  insert into eo_rec_targets (recommendation_id, business_unit_id) select v_id, u from unnest(v_bus) u on conflict do nothing;
  -- links of a draft: exactly the list given
  if p_links is not null then
    v_wanted := '{}';
    for x in select * from jsonb_array_elements(okr_arr(p_links)) loop
      perform eo_add_link(p_actor, null, v_id, x ->> 'target_type', (x ->> 'target_id')::uuid, v_bus);
      v_wanted := v_wanted || (x ->> 'target_id')::uuid;
    end loop;
    update eo_links set removed_at = app_now(), removed_by = p_actor where recommendation_id = v_id and removed_at is null and not (target_id = any(v_wanted));
  end if;
  select * into r from eo_recommendations where id = v_id;
  if coalesce(p_publish, false) then
    if r.reason is null then raise exception 'VALIDATION_ERROR' using detail = 'say why you are recommending this'; end if;
    v_ref := eo_publish(p_actor, r);
    v_res := jsonb_build_object('id', v_id, 'reference', v_ref, 'status', 'ACTIVE', 'version', r.version + 1, 'replayed', false);
  else
    v_res := jsonb_build_object('id', v_id, 'status', 'DRAFT', 'version', r.version, 'replayed', false);
  end if;
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

create or replace function publish_eo_recommendation(p_actor uuid, p_rec uuid, p_expected_version int, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; r eo_recommendations; v_ref text; v_bus uuid[]; b uuid; v_res jsonb;
begin
  perform require_permission(p_actor, 'executive_recommendation.create');
  v_prev := okr_idem(p_actor, p_key, 'publish_eo_recommendation'); if v_prev is not null then return v_prev; end if;
  select * into r from eo_recommendations where id = p_rec for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.author_id <> p_actor then if eo_rec_visible_to(p_actor, r.id) then raise exception 'PERMISSION_DENIED' using detail = 'only the author can publish a recommendation'; else raise exception 'BU_SCOPE_DENIED'; end if; end if;
  if r.status <> 'DRAFT' then raise exception 'INVALID_STATE_TRANSITION'; end if;
  perform okr_check_version(p_expected_version, r.version);
  if r.reason is null then raise exception 'VALIDATION_ERROR' using detail = 'say why you are recommending this'; end if;
  select array_agg(business_unit_id) into v_bus from eo_rec_targets where recommendation_id = r.id;
  if v_bus is null then raise exception 'VALIDATION_ERROR' using detail = 'choose at least one business unit to address'; end if;
  foreach b in array v_bus loop perform eo_assert_writable_bu(p_actor, b); end loop;
  if r.response_due is not null and r.response_due < okr_today_wat() then raise exception 'VALIDATION_ERROR' using detail = 'the response deadline is in the past; change it first'; end if;
  v_ref := eo_publish(p_actor, r);
  v_res := jsonb_build_object('id', r.id, 'reference', v_ref, 'status', 'ACTIVE', 'version', r.version + 1, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- the author withdraws the whole recommendation (every addressed unit); the record and everything said stay
create or replace function withdraw_eo_recommendation(p_actor uuid, p_rec uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r eo_recommendations; v_reason text := okr_clean(p_reason, 2000, 'the reason', true); t record;
begin
  perform require_permission(p_actor, 'executive_recommendation.withdraw');
  select * into r from eo_recommendations where id = p_rec for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not eo_rec_visible_to(p_actor, r.id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if r.author_id <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the author can withdraw a recommendation'; end if;
  if r.status not in ('DRAFT','ACTIVE') then raise exception 'INVALID_STATE_TRANSITION' using detail = r.status || ' to WITHDRAWN'; end if;
  update eo_recommendations set status = 'WITHDRAWN', withdrawn_at = app_now(), withdrawn_reason = v_reason, version = version + 1, updated_at = app_now() where id = r.id;
  for t in select * from eo_rec_targets where recommendation_id = r.id and status not in ('CLOSED','WITHDRAWN') loop
    update eo_rec_targets set status = 'WITHDRAWN', awaiting = null, version = version + 1 where id = t.id;
  end loop;
  perform eo_log(p_actor, null, r.id, null, 'WITHDRAWN', null, jsonb_build_object('reason', v_reason, 'was', r.status));
  if r.status = 'ACTIVE' then
    for t in select * from eo_rec_targets where recommendation_id = r.id loop
      perform okr_notify(p_actor, eo_bu_leads(t.business_unit_id) || coalesce(t.responsible_user_id, '00000000-0000-0000-0000-000000000000'::uuid), 'EO_REC_CLOSED', 'eo_recommendation', r.id, 'Recommendation withdrawn: ' || r.reference, 'Reason: ' || left(v_reason, 250), 'eo:' || r.id || ':wd:' || t.id);
    end loop;
  end if;
  return jsonb_build_object('id', r.id, 'status', 'WITHDRAWN', 'version', r.version + 1);
end $$;

-- ------------------------------------------------------------------ the addressed unit's side
create or replace function eo_get_target(p_actor uuid, p_target uuid) returns eo_rec_targets
language plpgsql security definer set search_path = public, pg_temp as $$
declare t eo_rec_targets; v_rec uuid;
begin
  select recommendation_id into v_rec from eo_rec_targets where id = p_target;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from eo_recommendations where id = v_rec for update;          -- always the recommendation first, then the unit's record, so two operations cannot deadlock
  select * into t from eo_rec_targets where id = p_target for update;
  if not eo_target_visible_to(p_actor, t.id) then raise exception 'BU_SCOPE_DENIED'; end if;
  return t;
end $$;

-- the unit's own people answer for it: the target unit must be the actor's own unit (an Executive's view_all gives no right to answer on a unit's behalf)
create or replace function eo_assert_responder(p_actor uuid, t eo_rec_targets, r eo_recommendations) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if t.business_unit_id is distinct from actor_bu(p_actor) then raise exception 'BU_SCOPE_DENIED'; end if;
  if r.status <> 'ACTIVE' then raise exception 'RECOMMENDATION_CLOSED' using detail = 'this recommendation is ' || lower(r.status); end if;
end $$;

create or replace function eo_target_set(t eo_rec_targets, p_status text, p_awaiting text, p_decision text default null, p_responded boolean default false, p_responsible uuid default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  update eo_rec_targets set status = p_status, awaiting = p_awaiting, decision = coalesce(p_decision, decision),
         responded_at = case when p_responded and responded_at is null then app_now() else responded_at end,
         responsible_user_id = coalesce(responsible_user_id, p_responsible), version = version + 1, last_activity_at = app_now()
   where id = t.id;
$$;

create or replace function acknowledge_eo_target(p_actor uuid, p_target uuid, p_expected_version int, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; t eo_rec_targets; r eo_recommendations; v_to text; v_res jsonb;
begin
  perform require_permission(p_actor, 'executive_recommendation.respond');
  v_prev := okr_idem(p_actor, p_key, 'acknowledge_eo_target'); if v_prev is not null then return v_prev; end if;
  t := eo_get_target(p_actor, p_target); select * into r from eo_recommendations where id = t.recommendation_id;
  perform eo_assert_responder(p_actor, t, r);
  perform okr_check_version(p_expected_version, t.version);
  if t.status <> 'SUBMITTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = t.status || ' to ACKNOWLEDGED'; end if;
  v_to := case when r.response_requested then 'RESPONSE_REQUESTED' else 'ACKNOWLEDGED' end;
  update eo_rec_targets set status = v_to, awaiting = case when r.response_requested then 'BU' else null end, acknowledged_at = app_now(), acknowledged_by = p_actor,
         responsible_user_id = coalesce(responsible_user_id, p_actor), version = version + 1, last_activity_at = app_now() where id = t.id;
  perform eo_log(p_actor, null, r.id, t.id, 'ACKNOWLEDGED', null, jsonb_build_object('status', v_to));
  perform okr_notify(p_actor, array[r.author_id], 'EO_REC_RESPONSE', 'eo_recommendation', r.id, r.reference || ' acknowledged', (select name from business_units where id = t.business_unit_id) || ' acknowledged your recommendation.', 'eo:' || t.id || ':ack');
  v_res := jsonb_build_object('id', t.id, 'status', v_to, 'version', t.version + 1, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- p_decision: ACCEPT | PARTIAL | DECLINE | ALTERNATIVE | CONSIDERING | CLARIFICATION. A decline needs a reason; partial and alternative need an explanation.
create or replace function respond_eo_target(p_actor uuid, p_target uuid, p_decision text, p_body text, p_expected_version int, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; t eo_rec_targets; r eo_recommendations; v_body text; v_status text; v_awaiting text; v_event text; v_final boolean := true; v_mail text; v_res jsonb; v_unit text;
begin
  perform require_permission(p_actor, 'executive_recommendation.respond');
  v_prev := okr_idem(p_actor, p_key, 'respond_eo_target'); if v_prev is not null then return v_prev; end if;
  if p_decision not in ('ACCEPT','PARTIAL','DECLINE','ALTERNATIVE','CONSIDERING','CLARIFICATION') then raise exception 'VALIDATION_ERROR' using detail = 'unknown response'; end if;
  t := eo_get_target(p_actor, p_target); select * into r from eo_recommendations where id = t.recommendation_id;
  perform eo_assert_responder(p_actor, t, r);
  perform okr_check_version(p_expected_version, t.version);
  if t.status not in ('SUBMITTED','ACKNOWLEDGED','RESPONSE_REQUESTED','UNDER_CONSIDERATION','RESPONSE_SUBMITTED') then raise exception 'INVALID_STATE_TRANSITION' using detail = t.status || ' to ' || p_decision; end if;
  if p_decision = 'DECLINE' then
    v_body := okr_clean(p_body, 10000, 'the reason', true);
  elsif p_decision in ('PARTIAL','ALTERNATIVE','CLARIFICATION') then
    v_body := okr_clean(p_body, 10000, 'the explanation', true);
  else v_body := okr_clean(p_body, 10000, 'the response'); end if;
  select name into v_unit from business_units where id = t.business_unit_id;
  case p_decision
    when 'ACCEPT'        then v_status := 'ACCEPTED_FOR_ACTION'; v_awaiting := null;        v_event := 'ACCEPTED';          v_mail := 'EO_REC_DECISION';
    when 'PARTIAL'       then v_status := 'PARTIALLY_ACCEPTED';  v_awaiting := null;        v_event := 'PARTIALLY_ACCEPTED'; v_mail := 'EO_REC_DECISION';
    when 'DECLINE'       then v_status := 'NOT_ACCEPTED';        v_awaiting := null;        v_event := 'DECLINED';          v_mail := 'EO_REC_DECISION';
    when 'ALTERNATIVE'   then v_status := 'RESPONSE_SUBMITTED';  v_awaiting := 'EXECUTIVE'; v_event := 'ALTERNATIVE_PROPOSED'; v_mail := 'EO_REC_RESPONSE';
    when 'CONSIDERING'   then v_status := 'UNDER_CONSIDERATION'; v_awaiting := 'BU';        v_event := 'UNDER_CONSIDERATION'; v_mail := 'EO_REC_RESPONSE'; v_final := false;
    else                      v_status := case when t.status = 'SUBMITTED' then 'ACKNOWLEDGED' else t.status end; v_awaiting := 'EXECUTIVE'; v_event := 'CLARIFICATION_REQUESTED'; v_mail := 'EO_REC_CLARIFICATION'; v_final := false;
  end case;
  update eo_rec_targets set status = v_status, awaiting = v_awaiting, decision = case when p_decision = 'CLARIFICATION' then decision else p_decision end,
         responded_at = case when p_decision <> 'CLARIFICATION' and responded_at is null then app_now() else responded_at end,
         acknowledged_at = coalesce(acknowledged_at, app_now()), acknowledged_by = coalesce(acknowledged_by, p_actor),
         responsible_user_id = coalesce(responsible_user_id, p_actor), version = version + 1, last_activity_at = app_now() where id = t.id;
  perform eo_log(p_actor, null, r.id, t.id, v_event, v_body, jsonb_build_object('decision', p_decision, 'from', t.status, 'to', v_status));
  perform okr_notify(p_actor, array[r.author_id], v_mail, 'eo_recommendation', r.id, r.reference || ': ' || v_unit || ' - ' || lower(replace(v_event, '_', ' ')), left(coalesce(v_body, 'No further comment.'), 300), 'eo:' || t.id || ':' || v_event || ':' || (t.version + 1));
  v_res := jsonb_build_object('id', t.id, 'status', v_status, 'version', t.version + 1, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- implementation progress. Reporting "implemented" does not change any OKR record; the unit makes the change through its own workflow (and can link it with set_eo_link).
create or replace function update_eo_progress(p_actor uuid, p_target uuid, p_kind text, p_body text, p_expected_version int, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; t eo_rec_targets; r eo_recommendations; v_body text := okr_clean(p_body, 10000, 'the update', true); v_status text; v_res jsonb;
begin
  perform require_permission(p_actor, 'executive_recommendation.update_progress');
  v_prev := okr_idem(p_actor, p_key, 'update_eo_progress'); if v_prev is not null then return v_prev; end if;
  if p_kind not in ('PROGRESS','IMPLEMENTED') then raise exception 'VALIDATION_ERROR' using detail = 'unknown update kind'; end if;
  t := eo_get_target(p_actor, p_target); select * into r from eo_recommendations where id = t.recommendation_id;
  perform eo_assert_responder(p_actor, t, r);
  perform okr_check_version(p_expected_version, t.version);
  if t.status not in ('ACCEPTED_FOR_ACTION','PARTIALLY_ACCEPTED','IMPLEMENTATION_IN_PROGRESS') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'progress can be reported only on an accepted recommendation'; end if;
  v_status := case p_kind when 'PROGRESS' then 'IMPLEMENTATION_IN_PROGRESS' else 'IMPLEMENTATION_REPORTED' end;
  perform eo_target_set(t, v_status, null);
  perform eo_log(p_actor, null, r.id, t.id, case p_kind when 'PROGRESS' then 'PROGRESS_REPORTED' else 'IMPLEMENTATION_REPORTED' end, v_body, jsonb_build_object('from', t.status, 'to', v_status));
  perform okr_notify(p_actor, array[r.author_id], 'EO_REC_UPDATE', 'eo_recommendation', r.id, r.reference || ': ' || case p_kind when 'PROGRESS' then 'progress reported' else 'reported as implemented' end, left(v_body, 300), 'eo:' || t.id || ':upd:' || (t.version + 1));
  v_res := jsonb_build_object('id', t.id, 'status', v_status, 'version', t.version + 1, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- the unit changes its contact (a person left or was suspended): the unit's own respond holders only
create or replace function reassign_eo_target(p_actor uuid, p_target uuid, p_new_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t eo_rec_targets; r eo_recommendations; v_reason text := okr_clean(p_reason, 2000, 'the reason', true);
begin
  perform require_permission(p_actor, 'executive_recommendation.respond');
  t := eo_get_target(p_actor, p_target); select * into r from eo_recommendations where id = t.recommendation_id;
  perform eo_assert_responder(p_actor, t, r);
  if t.status in ('CLOSED','WITHDRAWN') then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if not exists (select 1 from users u join employees e on e.id = u.employee_id where u.id = p_new_user and u.status = 'ACTIVE' and e.business_unit_id = t.business_unit_id) then
    raise exception 'RECIPIENT_UNAVAILABLE' using detail = 'choose an active member of the unit';
  end if;
  update eo_rec_targets set responsible_user_id = p_new_user, version = version + 1, last_activity_at = app_now() where id = t.id;
  perform eo_log(p_actor, null, r.id, t.id, 'REASSIGNED', null, jsonb_build_object('from', t.responsible_user_id, 'to', p_new_user, 'reason', v_reason));
  perform okr_notify(p_actor, array[p_new_user], 'EO_REC_NEW', 'eo_recommendation', r.id, 'You are now the contact for ' || r.reference, r.title, 'eo:' || t.id || ':contact:' || (t.version + 1));
  return jsonb_build_object('id', t.id, 'version', t.version + 1);
end $$;

-- ------------------------------------------------------------------ conversation on a recommendation
create or replace function reply_eo_recommendation(p_actor uuid, p_rec uuid, p_target uuid, p_body text, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; r eo_recommendations; t eo_rec_targets; v_body text := okr_clean(p_body, 10000, 'the reply', true); v_ev uuid; v_all boolean; v_to uuid[]; v_res jsonb; v_flip boolean := false;
begin
  perform require_permission(p_actor, 'executive_comment.reply');
  v_prev := okr_idem(p_actor, p_key, 'reply_eo_recommendation'); if v_prev is not null then return v_prev; end if;
  select * into r from eo_recommendations where id = p_rec for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not eo_rec_visible_to(p_actor, r.id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if r.status <> 'ACTIVE' then raise exception 'RECOMMENDATION_CLOSED' using detail = 'this recommendation is ' || lower(r.status); end if;
  v_all := actor_has_permission(p_actor, 'executive_oversight.view_all');
  if p_target is not null then
    select * into t from eo_rec_targets where id = p_target and recommendation_id = r.id for update;
    if not found or not eo_target_visible_to(p_actor, t.id) then raise exception 'BU_SCOPE_DENIED'; end if;
  elsif not v_all and r.author_id <> p_actor then
    select * into t from eo_rec_targets where recommendation_id = r.id and business_unit_id = actor_bu(p_actor) for update;      -- a unit's person speaks to their own unit's thread
  end if;
  v_ev := eo_log(p_actor, null, r.id, t.id, 'MESSAGE', v_body, null);
  if t.id is not null then
    -- the author answering a clarification hands the move back to the unit; the unit answering a follow-up question clears it
    if r.author_id = p_actor and t.awaiting = 'EXECUTIVE' then
      update eo_rec_targets set awaiting = case when r.response_requested and t.status in ('SUBMITTED','ACKNOWLEDGED','RESPONSE_REQUESTED','UNDER_CONSIDERATION') then 'BU' else null end, version = version + 1 where id = t.id; v_flip := true;
    elsif t.business_unit_id = actor_bu(p_actor) and t.awaiting = 'BU' and t.status not in ('SUBMITTED','ACKNOWLEDGED','RESPONSE_REQUESTED','UNDER_CONSIDERATION') then
      update eo_rec_targets set awaiting = null, version = version + 1 where id = t.id; v_flip := true;
    end if;
  end if;
  if r.author_id = p_actor or v_all then v_to := case when t.id is not null then eo_bu_leads(t.business_unit_id) || coalesce(t.responsible_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                                       else (select coalesce(array_agg(distinct y), '{}') from eo_rec_targets x, unnest(eo_bu_leads(x.business_unit_id)) y where x.recommendation_id = r.id) end;
  else v_to := array[r.author_id]; end if;
  perform okr_notify(p_actor, v_to, 'EO_COMMENT_REPLY', 'eo_recommendation', r.id, 'New message on ' || r.reference, left(v_body, 300), 'eo:' || v_ev || ':msg');
  v_res := jsonb_build_object('id', v_ev, 'recommendation_id', r.id, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- the author's follow-up question to one unit after its response: the unit is asked to answer again
create or replace function ask_eo_follow_up(p_actor uuid, p_target uuid, p_body text, p_expected_version int, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; t eo_rec_targets; r eo_recommendations; v_body text := okr_clean(p_body, 10000, 'the question', true); v_status text; v_res jsonb;
begin
  perform require_permission(p_actor, 'executive_recommendation.create');
  v_prev := okr_idem(p_actor, p_key, 'ask_eo_follow_up'); if v_prev is not null then return v_prev; end if;
  t := eo_get_target(p_actor, p_target); select * into r from eo_recommendations where id = t.recommendation_id;
  if r.author_id <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the author can ask a follow-up question'; end if;
  if r.status <> 'ACTIVE' then raise exception 'RECOMMENDATION_CLOSED'; end if;
  perform okr_check_version(p_expected_version, t.version);
  if t.status in ('DRAFT','SUBMITTED','CLOSED','WITHDRAWN') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'a follow-up can be asked once the unit has acknowledged'; end if;
  v_status := case when t.status = 'RESPONSE_SUBMITTED' then 'RESPONSE_REQUESTED' else t.status end;
  update eo_rec_targets set status = v_status, awaiting = 'BU', version = version + 1, last_activity_at = app_now() where id = t.id;
  perform eo_log(p_actor, null, r.id, t.id, 'FOLLOW_UP_QUESTION', v_body, jsonb_build_object('from', t.status, 'to', v_status));
  perform okr_notify(p_actor, eo_bu_leads(t.business_unit_id) || coalesce(t.responsible_user_id, '00000000-0000-0000-0000-000000000000'::uuid), 'EO_REC_CLARIFICATION', 'eo_recommendation', r.id, r.reference || ': a follow-up question', left(v_body, 300), 'eo:' || t.id || ':fu:' || (t.version + 1));
  v_res := jsonb_build_object('id', t.id, 'status', v_status, 'version', t.version + 1, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- Closing says the author is done following it up. It does NOT say the underlying matter is resolved, and it changes nothing in the OKR records.
-- p_target null closes every addressed unit that is still open. The author closes; if the author is no longer active, another holder of the close permission may.
create or replace function close_eo_recommendation(p_actor uuid, p_rec uuid, p_target uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; r eo_recommendations; t record; v_reason text := okr_clean(p_reason, 2000, 'the reason', true); v_n int := 0; v_open int; v_res jsonb;
begin
  perform require_permission(p_actor, 'executive_recommendation.close');
  v_prev := okr_idem(p_actor, p_key, 'close_eo_recommendation'); if v_prev is not null then return v_prev; end if;
  select * into r from eo_recommendations where id = p_rec for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not eo_rec_visible_to(p_actor, r.id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if r.author_id <> p_actor and (exists (select 1 from users where id = r.author_id and status = 'ACTIVE') or not actor_has_permission(p_actor, 'executive_oversight.view_all')) then
    raise exception 'PERMISSION_DENIED' using detail = 'only the author can close a recommendation';
  end if;
  if r.status <> 'ACTIVE' then raise exception 'INVALID_STATE_TRANSITION' using detail = r.status || ' to CLOSED'; end if;
  for t in select * from eo_rec_targets where recommendation_id = r.id and (p_target is null or id = p_target) and status not in ('CLOSED','WITHDRAWN','DRAFT') for update loop
    update eo_rec_targets set status = 'CLOSED', awaiting = null, closed_at = app_now(), closed_by = p_actor, close_reason = v_reason, closed_without_response = (t.responded_at is null and r.response_requested),
           version = version + 1, last_activity_at = app_now() where id = t.id;
    perform eo_log(p_actor, null, r.id, t.id, 'CLOSED', null, jsonb_build_object('reason', v_reason, 'from', t.status, 'closed_without_response', (t.responded_at is null and r.response_requested),
                   'note', 'closing a recommendation does not mean the matter is resolved'));
    perform okr_notify(p_actor, eo_bu_leads(t.business_unit_id) || coalesce(t.responsible_user_id, '00000000-0000-0000-0000-000000000000'::uuid), 'EO_REC_CLOSED', 'eo_recommendation', r.id, 'Recommendation closed: ' || r.reference, 'Reason: ' || left(v_reason, 250), 'eo:' || t.id || ':closed');
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'INVALID_STATE_TRANSITION' using detail = 'nothing is open to close'; end if;
  select count(*) into v_open from eo_rec_targets where recommendation_id = r.id and status not in ('CLOSED','WITHDRAWN');
  if v_open = 0 then update eo_recommendations set status = 'CLOSED', version = version + 1, updated_at = app_now() where id = r.id; end if;
  v_res := jsonb_build_object('id', r.id, 'closed_units', v_n, 'status', case when v_open = 0 then 'CLOSED' else 'ACTIVE' end, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- ------------------------------------------------------------------ links (references only)
create or replace function set_eo_link(p_actor uuid, p_comment uuid, p_rec uuid, p_target_type text, p_target_id uuid, p_remove boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c eo_comments; r eo_recommendations; v_bus uuid[]; v_author boolean; v_responder boolean := false; v_found boolean;
begin
  if (p_comment is null) = (p_rec is null) then raise exception 'VALIDATION_ERROR' using detail = 'link either a comment or a recommendation'; end if;
  if p_comment is not null then
    perform require_permission(p_actor, 'executive_comment.create');
    select * into c from eo_comments where id = p_comment for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if not eo_comment_visible_to(p_actor, c.id) then raise exception 'BU_SCOPE_DENIED'; end if;
    if c.author_id <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the author can change the links of a comment'; end if;
    if c.status <> 'PUBLISHED' then raise exception 'COMMENT_WITHDRAWN'; end if;
    v_bus := case when c.business_unit_id is null then '{}'::uuid[] else array[c.business_unit_id] end;
  else
    select * into r from eo_recommendations where id = p_rec for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if not eo_rec_visible_to(p_actor, r.id) then raise exception 'BU_SCOPE_DENIED'; end if;
    if r.status not in ('DRAFT','ACTIVE') then raise exception 'RECOMMENDATION_CLOSED'; end if;
    v_author := r.author_id = p_actor and actor_has_permission(p_actor, 'executive_recommendation.create');
    if not v_author then
      -- the addressed unit may add the record it uses to carry the recommendation out (its own workflow item), never remove another person's link
      v_responder := (actor_has_permission(p_actor, 'executive_recommendation.respond') or actor_has_permission(p_actor, 'executive_recommendation.update_progress'))
                     and exists (select 1 from eo_rec_targets x where x.recommendation_id = r.id and x.business_unit_id = actor_bu(p_actor));
      if not v_responder then raise exception 'PERMISSION_DENIED' using detail = 'only the author or the addressed unit can link records'; end if;
      if coalesce(p_remove, false) then raise exception 'PERMISSION_DENIED' using detail = 'only the author can remove a link'; end if;
      v_bus := array[actor_bu(p_actor)];
    else
      v_bus := array(select business_unit_id from eo_rec_targets where recommendation_id = r.id);
    end if;
  end if;
  if coalesce(p_remove, false) then
    update eo_links set removed_at = app_now(), removed_by = p_actor where coalesce(comment_id, recommendation_id) = coalesce(p_comment, p_rec) and target_type = p_target_type and target_id = p_target_id and removed_at is null;
    get diagnostics v_found = row_count;
    if not v_found then raise exception 'NOT_FOUND'; end if;
    perform eo_log(p_actor, p_comment, p_rec, null, 'LINK_REMOVED', null, jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id));
  else
    perform eo_add_link(p_actor, p_comment, p_rec, p_target_type, p_target_id, v_bus);
  end if;
end $$;

-- ------------------------------------------------------------------ attachments (the private 'evidence' bucket and its upload checks are reused by the API)
create or replace function record_eo_attachment(p_actor uuid, p_comment uuid, p_rec uuid, p_name text, p_mime text, p_size bigint, p_checksum text, p_path text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c eo_comments; r eo_recommendations; t eo_rec_targets; v_id uuid; v_target uuid;
begin
  if (p_comment is null) = (p_rec is null) then raise exception 'VALIDATION_ERROR' using detail = 'attach to either a comment or a recommendation'; end if;
  if p_size is null or p_size <= 0 or p_checksum is null or p_path is null or p_name is null or p_mime is null then raise exception 'VALIDATION_ERROR' using detail = 'file details are incomplete'; end if;
  if p_comment is not null then
    select * into c from eo_comments where id = p_comment;
    if not found then raise exception 'NOT_FOUND'; end if;
    if not eo_comment_visible_to(p_actor, c.id) then raise exception 'BU_SCOPE_DENIED'; end if;
    perform require_permission(p_actor, 'executive_comment.reply');
    if c.status <> 'PUBLISHED' then raise exception 'COMMENT_WITHDRAWN'; end if;
  else
    select * into r from eo_recommendations where id = p_rec;
    if not found then raise exception 'NOT_FOUND'; end if;
    if not eo_rec_visible_to(p_actor, r.id) then raise exception 'BU_SCOPE_DENIED'; end if;
    if r.status not in ('DRAFT','ACTIVE') then raise exception 'RECOMMENDATION_CLOSED'; end if;
    if r.author_id = p_actor then perform require_permission(p_actor, 'executive_recommendation.create');
    else
      if not (actor_has_permission(p_actor, 'executive_recommendation.respond') or actor_has_permission(p_actor, 'executive_recommendation.update_progress')) then raise exception 'PERMISSION_DENIED'; end if;
      select * into t from eo_rec_targets where recommendation_id = r.id and business_unit_id = actor_bu(p_actor);
      if not found then raise exception 'BU_SCOPE_DENIED'; end if;
      v_target := t.id;
    end if;
  end if;
  insert into eo_attachments (comment_id, recommendation_id, target_id, file_name, mime_type, size_bytes, checksum, storage_path, uploaded_by)
  values (p_comment, p_rec, v_target, left(btrim(p_name), 255), p_mime, p_size, p_checksum, p_path, p_actor) returning id into v_id;
  perform eo_log(p_actor, p_comment, p_rec, v_target, 'ATTACHMENT_ADDED', null, jsonb_build_object('attachment_id', v_id, 'file_name', left(btrim(p_name), 255), 'size_bytes', p_size));
  return v_id;
end $$;

create or replace function remove_eo_attachment(p_actor uuid, p_attachment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a eo_attachments; v_reason text := okr_clean(p_reason, 1000, 'the reason', true);
begin
  select * into a from eo_attachments where id = p_attachment for update;
  if not found or a.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
  if a.comment_id is not null then
    if not eo_comment_visible_to(p_actor, a.comment_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  elsif not eo_rec_item_visible_to(p_actor, a.recommendation_id, a.target_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if a.uploaded_by <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the person who attached a file can withdraw it'; end if;
  update eo_attachments set deleted_at = app_now(), deleted_by = p_actor, removal_reason = v_reason where id = a.id;     -- the bytes stay in the private bucket; the history keeps the fact
  perform eo_log(p_actor, a.comment_id, a.recommendation_id, a.target_id, 'ATTACHMENT_REMOVED', null, jsonb_build_object('attachment_id', a.id, 'file_name', a.file_name, 'reason', v_reason));
end $$;

create or replace function record_eo_attachment_scan(p_actor uuid, p_record uuid, p_file_name text, p_engine text, p_outcome text, p_detail text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform write_audit(p_actor, 'EXEC_OVERSIGHT_ATTACHMENT_SCAN', 'eo_attachment', p_record::text, null, jsonb_build_object('file_name', left(p_file_name, 255), 'engine', p_engine, 'outcome', p_outcome, 'detail', left(p_detail, 500)), null, null,
                      case when p_outcome = 'CLEAN' then 'SUCCESS' else 'FAILURE' end);
end $$;

-- ------------------------------------------------------------------ configuration (Admin / Super Admin: the lists only, never the commentary)
create or replace function save_eo_category(p_actor uuid, p_id uuid, p_code text, p_name text, p_description text, p_sort int, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_name text := okr_clean(p_name, 100, 'a name', true);
begin
  perform require_permission(p_actor, 'executive_oversight.configure');
  if v_id is null then
    if p_code is null or p_code !~ '^[A-Z][A-Z0-9_]{1,39}$' then raise exception 'VALIDATION_ERROR' using detail = 'the code is capital letters, digits and underscores (2 to 40 characters)'; end if;
    insert into eo_categories (code, name, description, sort_order, active) values (p_code, v_name, okr_clean(p_description, 500, 'the description'), coalesce(p_sort, 100), coalesce(p_active, true)) returning id into v_id;
  else
    update eo_categories set name = v_name, description = okr_clean(p_description, 500, 'the description'), sort_order = coalesce(p_sort, sort_order), active = coalesce(p_active, active), updated_at = app_now() where id = v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  perform write_audit(p_actor, 'EXEC_OVERSIGHT_CATEGORY_SAVED', 'eo_category', v_id::text, null, jsonb_build_object('name', v_name, 'active', p_active, 'code', p_code));
  return v_id;
exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'that category code already exists';
end $$;

create or replace function save_eo_escalation_rule(p_actor uuid, p_stage text, p_days int, p_recipient_kind text, p_role_code text, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old eo_escalation_rules;
begin
  perform require_permission(p_actor, 'executive_oversight.configure');
  select * into v_old from eo_escalation_rules where stage = p_stage;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_days is null or p_days < 0 or p_days > 90 then raise exception 'VALIDATION_ERROR' using detail = 'days must be between 0 and 90'; end if;
  if p_recipient_kind = 'ROLE' and not exists (select 1 from roles where code = p_role_code) then raise exception 'VALIDATION_ERROR' using detail = 'unknown role'; end if;
  update eo_escalation_rules set days = p_days, recipient_kind = p_recipient_kind, role_code = case when p_recipient_kind = 'ROLE' then p_role_code else null end, active = coalesce(p_active, active), updated_at = app_now() where stage = p_stage;
  perform write_audit(p_actor, 'EXEC_OVERSIGHT_ESCALATION_RULE_SAVED', 'eo_escalation_rule', p_stage, to_jsonb(v_old), jsonb_build_object('days', p_days, 'recipient_kind', p_recipient_kind, 'role_code', p_role_code, 'active', p_active));
end $$;

-- people of a unit who can be named as the recommended or responsible contact (names only)
create or replace function list_eo_people(p_actor uuid, p_bu uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (actor_has_permission(p_actor, 'executive_recommendation.create') or actor_has_permission(p_actor, 'executive_recommendation.respond')) then return '[]'::jsonb; end if;
  if not actor_has_permission(p_actor, 'executive_oversight.view_all') and p_bu is distinct from actor_bu(p_actor) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', e.first_name || ' ' || e.last_name, 'is_lead', actor_has_permission(u.id, 'executive_recommendation.respond')) order by e.first_name, e.last_name), '[]'::jsonb)
          from users u join employees e on e.id = u.employee_id where e.business_unit_id = p_bu and u.status = 'ACTIVE' and e.employment_status = 'ACTIVE' and not is_super_admin(u.id));
end $$;

-- ------------------------------------------------------------------ follow-up (called by the scheduler; idempotent per target, stage and deadline)
-- Reminders and escalation are communication only. Nothing here changes a compliance status, a score or a record of the unit.
create or replace function eo_rule_recipients(ru eo_escalation_rules, t eo_rec_targets, r eo_recommendations) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case ru.recipient_kind
    when 'BU_LEAD' then eo_bu_leads(t.business_unit_id)
    when 'RESPONSIBLE' then case when t.responsible_user_id is not null then array[t.responsible_user_id] else eo_bu_leads(t.business_unit_id) end
    when 'AUTHOR' then array[r.author_id]
    else users_with_role(ru.role_code) end;
$$;

create or replace function run_eo_follow_up() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t eo_rec_targets; r eo_recommendations; ru eo_escalation_rules; v_today date := okr_today_wat(); v_n int := 0; v_level int; v_unit text;
begin
  if not coalesce((select reminders_enabled from notification_settings where id), true) then return 0; end if;
  for t in select x.* from eo_rec_targets x join eo_recommendations q on q.id = x.recommendation_id
           where q.status = 'ACTIVE' and q.response_requested and q.response_due is not null and x.status in ('SUBMITTED','ACKNOWLEDGED','RESPONSE_REQUESTED','UNDER_CONSIDERATION') and coalesce(x.awaiting, 'BU') = 'BU' loop
    select * into r from eo_recommendations where id = t.recommendation_id;
    select name into v_unit from business_units where id = t.business_unit_id;
    for ru in select * from eo_escalation_rules where active order by case stage when 'APPROACHING' then 0 when 'OVERDUE_REMINDER' then 1 when 'OVERDUE_MANAGEMENT' then 2 else 3 end loop
      v_level := case ru.stage when 'OVERDUE_REMINDER' then 1 when 'OVERDUE_MANAGEMENT' then 2 when 'OVERDUE_SENIOR' then 3 else 0 end;
      if ru.stage = 'APPROACHING' then
        if r.response_due >= v_today and r.response_due - v_today <= ru.days then
          perform okr_notify(null, eo_rule_recipients(ru, t, r), 'EO_REC_DEADLINE', 'eo_recommendation', r.id, 'Response due ' || case when r.response_due = v_today then 'today' else 'on ' || to_char(r.response_due, 'DD Mon') end || ': ' || r.reference,
                             r.title || ' (' || v_unit || ')', 'eo:' || t.id || ':approaching:' || r.response_due);
          v_n := v_n + 1;
        end if;
      elsif v_today - r.response_due >= greatest(ru.days, 1) then
        if not exists (select 1 from eo_events e where e.target_id = t.id and e.event_type = 'ESCALATED' and e.details ->> 'stage' = ru.stage and e.details ->> 'due' = r.response_due::text) then
          perform eo_log(null, null, r.id, t.id, 'ESCALATED', null, jsonb_build_object('stage', ru.stage, 'due', r.response_due, 'days_overdue', v_today - r.response_due));
          update eo_rec_targets set escalation_level = greatest(escalation_level, v_level) where id = t.id;
        end if;
        perform okr_notify(null, eo_rule_recipients(ru, t, r), 'EO_REC_OVERDUE', 'eo_recommendation', r.id, 'Response overdue: ' || r.reference,
                           r.title || ' (' || v_unit || ') was due on ' || to_char(r.response_due, 'DD Mon YYYY') || '.', 'eo:' || t.id || ':overdue:' || ru.stage || ':' || r.response_due);
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  -- a contact who was suspended after receiving a recommendation: the unit's leads are told once so they can name someone else
  for t in select x.* from eo_rec_targets x join eo_recommendations q on q.id = x.recommendation_id join users u on u.id = x.responsible_user_id
           where q.status = 'ACTIVE' and x.status not in ('CLOSED','WITHDRAWN','DRAFT') and u.status <> 'ACTIVE' loop
    select * into r from eo_recommendations where id = t.recommendation_id;
    perform okr_notify(null, eo_bu_leads(t.business_unit_id), 'EO_REC_UPDATE', 'eo_recommendation', r.id, 'Contact unavailable for ' || r.reference, 'The person responsible is suspended. Choose another contact.', 'eo:' || t.id || ':contact-gone:' || t.responsible_user_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

do $$
declare v_def text; a text := 'begin perform ai_run_jobs();';
begin
  v_def := pg_get_functiondef('run_scheduled_jobs()'::regprocedure);
  if position('run_eo_follow_up' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'run_scheduled_jobs no longer contains the expected line'; end if;
  execute replace(v_def, a, 'begin perform run_eo_follow_up(); exception when others then get stacked diagnostics v_err = message_text; perform write_audit(null, ''JOB_FAILED'', ''job'', ''eo_follow_up'', null, jsonb_build_object(''error'', v_err), null, null, ''FAILURE''); end; ' || a);
end $$;

select lock_down_function_grants();
