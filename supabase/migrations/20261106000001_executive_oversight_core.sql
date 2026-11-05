-- Executive Oversight, Commentary & Recommendations, part 1 of 3: permissions, tables, visibility, row-level security.
-- (ADR-096..ADR-103 in docs/24-DECISIONS.md; module description in docs/41-EXECUTIVE-OVERSIGHT.md)
--
-- Additive only. Nothing existing is altered except the allow-list inside lock_down_function_grants() (RLS helpers must be callable by signed-in people).
-- The three safeguards this module is built on:
--  1. A comment is not a recommendation. Comments are observations and conversation; a recommendation is a separate record with its own lifecycle.
--  2. A recommendation is not an instruction. It is advice addressed to one or more business units, each of which accepts, partly accepts or declines it with a reason.
--     Nothing in this module writes to goals, tasks, reports, scores, attendance, violations, finance, strategy or compliance. Links are references only.
--  3. History is kept. Nothing is deleted; every settled earlier wording is kept; the event timeline is immutable (and mirrored into the audit log).
-- Reads go through row-level security; writes go only through SECURITY DEFINER functions (service role) that re-check permission, scope, state and write the audit in the same transaction.
-- HR, Finance, Admin and Super Admin hold NO oversight content permission (Admin and Super Admin only configure the category list and escalation timelines).

-- ------------------------------------------------------------------ permissions
insert into permissions (code, description, protected, reserved, module, risk) values
  ('executive_comment.view',               'Read executive comments about your own business unit that were shared with it',                          false, false, 'Executive oversight', 'low'),
  ('executive_comment.create',             'Post a comment on a business-unit matter you may already view',                                          false, false, 'Executive oversight', 'medium'),
  ('executive_comment.reply',              'Reply in a comment conversation you can read',                                                           false, false, 'Executive oversight', 'low'),
  ('executive_comment.amend',              'Amend or withdraw your own comment (the earlier wording is kept)',                                        false, false, 'Executive oversight', 'medium'),
  ('executive_recommendation.view',        'Read recommendations addressed to your own business unit',                                               false, false, 'Executive oversight', 'low'),
  ('executive_recommendation.create',      'Draft and publish a recommendation to one or more business units (advice, never an instruction)',        false, false, 'Executive oversight', 'high'),
  ('executive_recommendation.withdraw',    'Withdraw your own recommendation, with a reason',                                                        false, false, 'Executive oversight', 'medium'),
  ('executive_recommendation.close',       'Close a recommendation you issued (closing does not mean the underlying matter is resolved)',            false, false, 'Executive oversight', 'medium'),
  ('executive_recommendation.respond',     'Acknowledge, answer, accept, partly accept or decline a recommendation addressed to your business unit',  false, false, 'Executive oversight', 'high'),
  ('executive_recommendation.update_progress', 'Report implementation progress on an accepted recommendation of your business unit',                  false, false, 'Executive oversight', 'medium'),
  ('executive_oversight.dashboard.view',   'Open the Executive Oversight page',                                                                      false, false, 'Executive oversight', 'low'),
  ('executive_oversight.view_all',         'Read executive commentary and recommendations of every business unit (and management-only comments)',     true,  false, 'Executive oversight', 'critical'),
  ('executive_oversight.export',           'Export the oversight registers you can read',                                                            false, false, 'Executive oversight', 'medium'),
  ('executive_oversight.configure',        'Manage comment categories and escalation timelines (no access to the commentary itself)',                 false, false, 'Executive oversight', 'high');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('EXECUTIVE','executive_comment.view'), ('EXECUTIVE','executive_comment.create'), ('EXECUTIVE','executive_comment.reply'), ('EXECUTIVE','executive_comment.amend'),
  ('EXECUTIVE','executive_recommendation.view'), ('EXECUTIVE','executive_recommendation.create'), ('EXECUTIVE','executive_recommendation.withdraw'), ('EXECUTIVE','executive_recommendation.close'),
  ('EXECUTIVE','executive_oversight.dashboard.view'), ('EXECUTIVE','executive_oversight.view_all'), ('EXECUTIVE','executive_oversight.export'),
  ('DIRECTOR','executive_comment.view'), ('DIRECTOR','executive_comment.create'), ('DIRECTOR','executive_comment.reply'), ('DIRECTOR','executive_comment.amend'),
  ('DIRECTOR','executive_recommendation.view'), ('DIRECTOR','executive_recommendation.create'), ('DIRECTOR','executive_recommendation.withdraw'), ('DIRECTOR','executive_recommendation.close'),
  ('DIRECTOR','executive_oversight.dashboard.view'), ('DIRECTOR','executive_oversight.view_all'), ('DIRECTOR','executive_oversight.export'),
  ('BU_LEAD','executive_comment.view'), ('BU_LEAD','executive_comment.reply'),
  ('BU_LEAD','executive_recommendation.view'), ('BU_LEAD','executive_recommendation.respond'), ('BU_LEAD','executive_recommendation.update_progress'),
  ('BU_LEAD','executive_oversight.dashboard.view'), ('BU_LEAD','executive_oversight.export'),
  ('PRESENTER','executive_comment.view'), ('PRESENTER','executive_comment.reply'), ('PRESENTER','executive_recommendation.view'),
  ('ADMIN','executive_oversight.configure'), ('SUPER_ADMIN','executive_oversight.configure')
) v(role_code, perm) join roles r on r.code = v.role_code join permissions p on p.code = v.perm
on conflict do nothing;

-- ------------------------------------------------------------------ configurable lists
create table eo_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name        text not null check (btrim(name) <> '' and char_length(name) <= 100),
  description text check (description is null or char_length(description) <= 500),
  sort_order  int  not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default app_now(),
  updated_at  timestamptz not null default app_now()
);
insert into eo_categories (code, name, sort_order, description) values
  ('GENERAL_OBSERVATION',   'General observation',   10, 'An observation that needs no response'),
  ('PERFORMANCE_FEEDBACK',  'Performance feedback',  20, 'Feedback on how a unit, goal or result is performing'),
  ('CONCERN',               'Concern',               30, 'Something that worries the author'),
  ('CLARIFICATION_REQUEST', 'Clarification request', 40, 'A question the author would like answered'),
  ('MANAGEMENT_GUIDANCE',   'Management guidance',   50, 'Advice on how to approach a matter'),
  ('RECOMMENDATION',        'Recommendation',        60, 'A suggestion (use a formal recommendation when a response must be tracked)'),
  ('RECOGNITION',           'Recognition',           70, 'Appreciation of good work'),
  ('FOLLOW_UP_REQUEST',     'Follow-up request',     80, 'A request to revisit something later'),
  ('STRATEGIC_OBSERVATION', 'Strategic observation', 90, 'An observation about direction or alignment'),
  ('COMPLIANCE_CONCERN',    'Compliance concern',   100, 'A concern about compliance (it changes no compliance status)');

-- Escalation of a recommendation whose response is overdue. Timelines and recipients are configuration, not code.
create table eo_escalation_rules (
  stage          text primary key check (stage in ('APPROACHING','OVERDUE_REMINDER','OVERDUE_MANAGEMENT','OVERDUE_SENIOR')),
  days           int  not null check (days between 0 and 90),     -- APPROACHING: days before the deadline; the others: days after it
  recipient_kind text not null check (recipient_kind in ('BU_LEAD','RESPONSIBLE','AUTHOR','ROLE')),
  role_code      text,
  active         boolean not null default true,
  updated_at     timestamptz not null default app_now(),
  check ((recipient_kind = 'ROLE') = (role_code is not null))
);
insert into eo_escalation_rules (stage, days, recipient_kind, role_code) values
  ('APPROACHING', 2, 'RESPONSIBLE', null), ('OVERDUE_REMINDER', 1, 'BU_LEAD', null), ('OVERDUE_MANAGEMENT', 5, 'AUTHOR', null), ('OVERDUE_SENIOR', 10, 'ROLE', 'DIRECTOR');

-- ------------------------------------------------------------------ comments
create table eo_comments (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,
  category_id       uuid references eo_categories(id),
  title             text check (title is null or (btrim(title) <> '' and char_length(title) <= 200)),
  content           text not null check (btrim(content) <> '' and char_length(content) <= 10000),
  author_id         uuid not null references users(id),
  author_role       text not null,                           -- the author's role(s) when it was posted
  business_unit_id  uuid references business_units(id),     -- null = organisation-wide (readable only with executive_oversight.view_all)
  module            text not null check (module in ('DASHBOARD','BU_PERFORMANCE','WEEKLY_REPORT','PRESENTATION','STRATEGY','OBJECTIVE','KEY_RESULT','SUB_KEY_RESULT','GOAL','TASK','BU_GOAL','COMPLIANCE','RISK','HISTORICAL_REPORT','SESSION_NOTES','OTHER')),
  subject_type      text check (subject_type in ('BUSINESS_UNIT','ANNUAL_THEME','QUARTER','OBJECTIVE','KEY_RESULT','SUB_KEY_RESULT','BU_GOAL','WEEKLY_GOAL','TASK','WEEKLY_REPORT','SESSION','SESSION_NOTE','SESSION_DECISION','SESSION_ACTION','SESSION_RISK')),
  subject_id        uuid,
  subject_label     text,
  quarter_id        uuid references quarters(id),
  reporting_week_id uuid references reporting_weeks(id),
  visibility        text not null default 'SHARED' check (visibility in ('SHARED','MANAGEMENT')),   -- SHARED: the target unit sees it; MANAGEMENT: only holders of view_all
  status            text not null default 'PUBLISHED' check (status in ('PUBLISHED','WITHDRAWN')),
  version           int  not null default 1,
  created_at        timestamptz not null default app_now(),
  amended_at        timestamptz,
  withdrawn_at      timestamptz,
  withdrawn_reason  text,
  last_activity_at  timestamptz not null default app_now(),
  client_key        text,
  search            tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || content || ' ' || reference || ' ' || coalesce(subject_label, ''))) stored,
  check ((subject_type is null) = (subject_id is null))
);
create unique index eo_comments_client_key_idx on eo_comments (author_id, client_key) where client_key is not null;
create index eo_comments_bu_idx on eo_comments (business_unit_id, created_at desc);
create index eo_comments_subject_idx on eo_comments (subject_type, subject_id);
create index eo_comments_search_idx on eo_comments using gin (search);
create index eo_comments_author_idx on eo_comments (author_id, created_at desc);

create table eo_comment_versions (
  id           uuid primary key default gen_random_uuid(),
  comment_id   uuid not null references eo_comments(id) on delete restrict,
  version      int  not null,
  category_id  uuid references eo_categories(id),
  title        text,
  content      text not null,
  saved_at     timestamptz not null,
  replaced_by  uuid not null references users(id),
  replaced_at  timestamptz not null default app_now(),
  change_kind  text not null check (change_kind in ('AMENDED','WITHDRAWN')),
  reason       text not null,
  unique (comment_id, version)
);
create trigger eo_comment_versions_immutable before update or delete on eo_comment_versions for each row execute function forbid_mutation();

-- ------------------------------------------------------------------ recommendations (advice addressed to business units; one lifecycle per addressed unit)
create table eo_recommendations (
  id                  uuid primary key default gen_random_uuid(),
  reference           text unique,                                  -- assigned on publication
  category_id         uuid references eo_categories(id),
  title               text not null check (btrim(title) <> '' and char_length(title) <= 200),
  detail              text not null check (btrim(detail) <> '' and char_length(detail) <= 10000),
  background          text check (background is null or char_length(background) <= 10000),
  reason              text check (reason is null or char_length(reason) <= 10000),
  expected_outcome    text check (expected_outcome is null or char_length(expected_outcome) <= 5000),
  proposed_direction  text check (proposed_direction is null or char_length(proposed_direction) <= 5000),
  priority            text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','CRITICAL')),
  author_id           uuid not null references users(id),
  author_role         text not null,
  module              text not null check (module in ('DASHBOARD','BU_PERFORMANCE','WEEKLY_REPORT','PRESENTATION','STRATEGY','OBJECTIVE','KEY_RESULT','SUB_KEY_RESULT','GOAL','TASK','BU_GOAL','COMPLIANCE','RISK','HISTORICAL_REPORT','SESSION_NOTES','OTHER')),
  subject_type        text check (subject_type in ('BUSINESS_UNIT','ANNUAL_THEME','QUARTER','OBJECTIVE','KEY_RESULT','SUB_KEY_RESULT','BU_GOAL','WEEKLY_GOAL','TASK','WEEKLY_REPORT','SESSION','SESSION_NOTE','SESSION_DECISION','SESSION_ACTION','SESSION_RISK')),
  subject_id          uuid,
  subject_label       text,
  quarter_id          uuid references quarters(id),
  reporting_week_id   uuid references reporting_weeks(id),
  recommended_owner_role text check (recommended_owner_role is null or char_length(recommended_owner_role) <= 100),
  recommended_owner_user uuid references users(id),
  response_requested  boolean not null default false,
  response_due        date,
  status              text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','CLOSED','WITHDRAWN')),
  version             int  not null default 1,
  created_at          timestamptz not null default app_now(),
  updated_at          timestamptz not null default app_now(),
  published_at        timestamptz,
  withdrawn_at        timestamptz,
  withdrawn_reason    text,
  last_activity_at    timestamptz not null default app_now(),
  client_key          text,
  search              tsvector generated always as (to_tsvector('english', title || ' ' || detail || ' ' || coalesce(background, '') || ' ' || coalesce(reference, '') || ' ' || coalesce(subject_label, ''))) stored,
  check ((subject_type is null) = (subject_id is null)),
  check (response_due is null or response_requested),
  check (status = 'DRAFT' or reference is not null),
  check (status = 'DRAFT' or reason is not null)
);
create unique index eo_recommendations_client_key_idx on eo_recommendations (author_id, client_key) where client_key is not null;
create index eo_recommendations_author_idx on eo_recommendations (author_id, created_at desc);
create index eo_recommendations_status_idx on eo_recommendations (status, response_due);
create index eo_recommendations_subject_idx on eo_recommendations (subject_type, subject_id);
create index eo_recommendations_search_idx on eo_recommendations using gin (search);

-- one row per addressed business unit: its own acknowledgement, response and implementation record
create table eo_rec_targets (
  id                  uuid primary key default gen_random_uuid(),
  recommendation_id   uuid not null references eo_recommendations(id) on delete restrict,
  business_unit_id    uuid not null references business_units(id),
  status              text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','ACKNOWLEDGED','RESPONSE_REQUESTED','RESPONSE_SUBMITTED','UNDER_CONSIDERATION','ACCEPTED_FOR_ACTION','PARTIALLY_ACCEPTED','NOT_ACCEPTED','IMPLEMENTATION_IN_PROGRESS','IMPLEMENTATION_REPORTED','CLOSED','WITHDRAWN')),
  awaiting            text check (awaiting in ('BU','EXECUTIVE')),            -- whose move it is, when somebody is waiting
  decision            text check (decision in ('ACCEPT','PARTIAL','DECLINE','ALTERNATIVE','CONSIDERING')),
  responsible_user_id uuid references users(id),
  acknowledged_at     timestamptz,
  acknowledged_by     uuid references users(id),
  responded_at        timestamptz,
  closed_at           timestamptz,
  closed_by           uuid references users(id),
  close_reason        text,
  closed_without_response boolean not null default false,
  escalation_level    int not null default 0 check (escalation_level between 0 and 3),
  version             int not null default 1,
  last_activity_at    timestamptz not null default app_now(),
  created_at          timestamptz not null default app_now(),
  unique (recommendation_id, business_unit_id)
);
create index eo_rec_targets_bu_idx on eo_rec_targets (business_unit_id, status);
create index eo_rec_targets_resp_idx on eo_rec_targets (responsible_user_id) where responsible_user_id is not null;

-- ------------------------------------------------------------------ the timeline: replies, responses, updates, status changes. Immutable; mirrored into the audit log.
create table eo_events (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity,
  comment_id        uuid references eo_comments(id) on delete restrict,
  recommendation_id uuid references eo_recommendations(id) on delete restrict,
  target_id         uuid references eo_rec_targets(id) on delete restrict,      -- null = concerns every addressed unit
  event_type        text not null,
  actor_id          uuid references users(id),
  actor_role        text,
  body              text check (body is null or char_length(body) <= 10000),
  details           jsonb,
  occurred_at       timestamptz not null default app_now(),
  check ((comment_id is null) <> (recommendation_id is null))
);
create index eo_events_comment_idx on eo_events (comment_id, seq) where comment_id is not null;
create index eo_events_rec_idx on eo_events (recommendation_id, seq) where recommendation_id is not null;
create index eo_events_target_idx on eo_events (target_id, seq) where target_id is not null;
create trigger eo_events_immutable before update or delete on eo_events for each row execute function forbid_mutation();

-- ------------------------------------------------------------------ links to sessions, notes, decisions, actions, risks and OKR components (references only: linking never writes to the target)
create table eo_links (
  id                uuid primary key default gen_random_uuid(),
  comment_id        uuid references eo_comments(id) on delete restrict,
  recommendation_id uuid references eo_recommendations(id) on delete restrict,
  target_type       text not null check (target_type in ('ANNUAL_THEME','QUARTER','OBJECTIVE','KEY_RESULT','SUB_KEY_RESULT','BU_GOAL','WEEKLY_GOAL','TASK','WEEKLY_REPORT','SESSION','SESSION_NOTE','SESSION_DECISION','SESSION_ACTION','SESSION_RISK')),
  target_id         uuid not null,
  label             text not null,                         -- the target as it was named when linked; still readable if the target is archived later
  target_bu_id      uuid references business_units(id),
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default app_now(),
  removed_at        timestamptz,
  removed_by        uuid references users(id),
  check ((comment_id is null) <> (recommendation_id is null))
);
create unique index eo_links_unique_idx on eo_links (coalesce(comment_id, recommendation_id), target_type, target_id) where removed_at is null;
create index eo_links_target_idx on eo_links (target_type, target_id) where removed_at is null;
create index eo_links_comment_idx on eo_links (comment_id) where comment_id is not null;
create index eo_links_rec_idx on eo_links (recommendation_id) where recommendation_id is not null;

create table eo_attachments (
  id                uuid primary key default gen_random_uuid(),
  comment_id        uuid references eo_comments(id) on delete restrict,
  recommendation_id uuid references eo_recommendations(id) on delete restrict,
  target_id         uuid references eo_rec_targets(id) on delete restrict,
  file_name         text not null check (btrim(file_name) <> '' and char_length(file_name) <= 255),
  mime_type         text not null,
  size_bytes        bigint not null check (size_bytes > 0),
  checksum          text not null,
  storage_path      text not null unique,
  uploaded_by       uuid not null references users(id),
  uploaded_at       timestamptz not null default app_now(),
  deleted_at        timestamptz,
  deleted_by        uuid references users(id),
  removal_reason    text,
  check ((comment_id is null) <> (recommendation_id is null))
);
create index eo_attachments_comment_idx on eo_attachments (comment_id) where comment_id is not null and deleted_at is null;
create index eo_attachments_rec_idx on eo_attachments (recommendation_id) where recommendation_id is not null and deleted_at is null;
create trigger eo_attachments_immutable before update or delete on eo_attachments for each row execute function forbid_mutation();   -- removal (deleted_at/by) is the only change allowed

-- ------------------------------------------------------------------ integrity guards (defence in depth; the functions are the only writers)
create or replace function eo_comments_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'executive comments are never deleted'; end if;
  if new.id <> old.id or new.reference <> old.reference or new.author_id <> old.author_id or new.author_role <> old.author_role or new.created_at <> old.created_at
     or new.business_unit_id is distinct from old.business_unit_id or new.module <> old.module or new.subject_type is distinct from old.subject_type or new.subject_id is distinct from old.subject_id then
    raise exception 'IMMUTABLE_RECORD' using detail = 'the author, unit, module and subject of a comment cannot be changed';
  end if;
  if (new.content <> old.content or new.title is distinct from old.title or new.category_id is distinct from old.category_id)
     and not exists (select 1 from eo_comment_versions v where v.comment_id = old.id and v.version = old.version) then
    raise exception 'IMMUTABLE_RECORD' using detail = 'the earlier wording must be kept before a comment is amended';
  end if;
  return new;
end $$;
create trigger eo_comments_guard before update or delete on eo_comments for each row execute function eo_comments_guard();

create or replace function eo_recommendations_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'recommendations are never deleted'; end if;
  if new.id <> old.id or new.author_id <> old.author_id or new.author_role <> old.author_role or new.created_at <> old.created_at then
    raise exception 'IMMUTABLE_RECORD' using detail = 'the author of a recommendation cannot be changed';
  end if;
  if old.status <> 'DRAFT' and (new.title <> old.title or new.detail <> old.detail or new.background is distinct from old.background or new.reason is distinct from old.reason
     or new.expected_outcome is distinct from old.expected_outcome or new.proposed_direction is distinct from old.proposed_direction or new.priority <> old.priority
     or new.module <> old.module or new.subject_type is distinct from old.subject_type or new.subject_id is distinct from old.subject_id
     or new.response_requested <> old.response_requested or new.response_due is distinct from old.response_due or new.reference is distinct from old.reference) then
    raise exception 'IMMUTABLE_RECORD' using detail = 'a published recommendation cannot be edited; withdraw it and issue a new one, or add a note';
  end if;
  return new;
end $$;
create trigger eo_recommendations_guard before update or delete on eo_recommendations for each row execute function eo_recommendations_guard();

create or replace function eo_targets_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from eo_recommendations r where r.id = old.recommendation_id and r.status = 'DRAFT') then return old; end if;       -- a draft's addressee list may still change
    raise exception 'IMMUTABLE_RECORD' using detail = 'recommendation targets are never deleted';
  end if;
  if new.recommendation_id <> old.recommendation_id or new.business_unit_id <> old.business_unit_id then raise exception 'IMMUTABLE_RECORD' using detail = 'the addressed unit cannot be changed'; end if;
  return new;
end $$;
create trigger eo_targets_guard before update or delete on eo_rec_targets for each row execute function eo_targets_guard();

create trigger eo_links_no_delete before delete on eo_links for each row execute function forbid_mutation();

-- ------------------------------------------------------------------ visibility (the single definition used by RLS and by the functions)
-- A comment: the author; every holder of view_all; or, for SHARED comments, a holder of executive_comment.view in the target unit.
create or replace function eo_comment_visible_to(p_actor uuid, p_comment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from eo_comments c
    where c.id = p_comment and exists (select 1 from users u where u.id = p_actor and u.status = 'ACTIVE')
      and actor_has_permission(p_actor, 'executive_comment.view')
      and (c.author_id = p_actor
           or actor_has_permission(p_actor, 'executive_oversight.view_all')
           or (c.visibility = 'SHARED' and c.business_unit_id is not null and c.business_unit_id = actor_bu(p_actor))));
$$;

-- A recommendation: a draft only its author; otherwise its author, holders of view_all, and holders of executive_recommendation.view in an addressed unit.
create or replace function eo_rec_visible_to(p_actor uuid, p_rec uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from eo_recommendations r
    where r.id = p_rec and exists (select 1 from users u where u.id = p_actor and u.status = 'ACTIVE')
      and actor_has_permission(p_actor, 'executive_recommendation.view')
      and (r.author_id = p_actor
           or (r.status <> 'DRAFT' and (actor_has_permission(p_actor, 'executive_oversight.view_all')
                or exists (select 1 from eo_rec_targets t where t.recommendation_id = r.id and t.business_unit_id = actor_bu(p_actor))))));
$$;

-- One addressed unit's record: the author, holders of view_all, and people of that unit.
create or replace function eo_target_visible_to(p_actor uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from eo_rec_targets t join eo_recommendations r on r.id = t.recommendation_id
    where t.id = p_target and eo_rec_visible_to(p_actor, r.id)
      and (r.author_id = p_actor or actor_has_permission(p_actor, 'executive_oversight.view_all') or t.business_unit_id = actor_bu(p_actor)));
$$;

-- a timeline entry or file of a recommendation: visible with the recommendation, and (when it belongs to one unit) with that unit
create or replace function eo_rec_item_visible_to(p_actor uuid, p_rec uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select eo_rec_visible_to(p_actor, p_rec) and (p_target is null or eo_target_visible_to(p_actor, p_target));
$$;

-- a link to a session record is shown only to people who may read that session record themselves (a link never widens access)
create or replace function eo_link_target_visible_to(p_actor uuid, p_type text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_session uuid;
begin
  if p_type = 'SESSION' then return okr_session_visible_to(p_actor, p_id);
  elsif p_type = 'SESSION_NOTE' then
    return exists (select 1 from okr_session_notes n where n.id = p_id and okr_note_visible_to(p_actor, n.session_id, n.visibility, n.author_id));
  elsif p_type = 'SESSION_DECISION' then
    select session_id into v_session from okr_session_decisions where id = p_id;
  elsif p_type = 'SESSION_ACTION' then
    select origin_session_id into v_session from okr_session_actions where id = p_id;
  elsif p_type = 'SESSION_RISK' then
    select session_id into v_session from okr_session_risks where id = p_id;
  else return true;
  end if;
  return v_session is not null and okr_session_visible_to(p_actor, v_session);
end $$;

-- ------------------------------------------------------------------ what the row-level policies call
-- Policies are written so that everything about the caller (permission, own unit, own id, second-factor level) is computed ONCE per statement as an uncorrelated sub-select (an InitPlan),
-- and each row costs only column comparisons. (Calling the full visibility functions per row cost milliseconds each; see ADR-097.) The two helpers below answer a question about the
-- CALLER only (their own authorship, their own unit), so they reveal nothing about anybody else.
create or replace function eo_rec_is_mine(p_rec uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from eo_recommendations r where r.id = p_rec and r.author_id = auth.uid());
$$;
create or replace function eo_rec_in_my_unit(p_rec uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from eo_rec_targets t where t.recommendation_id = p_rec and t.business_unit_id = actor_bu(auth.uid()));
$$;
create or replace function auth_eo_link_target_visible(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$ select auth_aal_satisfied() and eo_link_target_visible_to(auth.uid(), p_type, p_id); $$;

do $$
declare v_def text; a text := '''auth_okr_session_visible'',';
begin
  v_def := pg_get_functiondef('lock_down_function_grants()'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'lock_down_function_grants changed'; end if;
  if position('eo_rec_is_mine' in v_def) > 0 then return; end if;
  execute replace(v_def, a, '''eo_rec_is_mine'',''eo_rec_in_my_unit'',''auth_eo_link_target_visible'',' || a);
end $$;

-- ------------------------------------------------------------------ row-level security (reads only; no insert, update or delete grant for signed-in people)
alter table eo_categories         enable row level security;
alter table eo_escalation_rules   enable row level security;
alter table eo_comments           enable row level security;
alter table eo_comment_versions   enable row level security;
alter table eo_recommendations    enable row level security;
alter table eo_rec_targets        enable row level security;
alter table eo_events             enable row level security;
alter table eo_links              enable row level security;
alter table eo_attachments        enable row level security;
grant select on eo_categories, eo_escalation_rules, eo_comments, eo_comment_versions, eo_recommendations, eo_rec_targets, eo_events, eo_links, eo_attachments to authenticated;

create policy read_lists on eo_categories for select to authenticated using ((select auth_has_any(array['executive_comment.view','executive_comment.create','executive_recommendation.view','executive_oversight.configure'])));
create policy read_rules on eo_escalation_rules for select to authenticated using ((select auth_has_any(array['executive_oversight.view_all','executive_oversight.configure'])));

-- A comment: the author; every holder of view_all; or, for a shared comment, a person of the target unit. (Always with executive_comment.view and a completed second factor.)
create policy read_visible on eo_comments for select to authenticated using (
  (select auth_aal_satisfied()) and (select auth_has_permission('executive_comment.view'))
  and (author_id = (select auth.uid()) or (select auth_has_permission('executive_oversight.view_all')) or (visibility = 'SHARED' and business_unit_id is not null and business_unit_id = (select auth_bu()))));
create policy read_visible on eo_comment_versions for select to authenticated using (exists (select 1 from eo_comments c where c.id = comment_id));

-- A recommendation: a draft only to its author; otherwise its author, holders of view_all, and people of an addressed unit.
create policy read_visible on eo_recommendations for select to authenticated using (
  (select auth_aal_satisfied()) and (select auth_has_permission('executive_recommendation.view'))
  and (author_id = (select auth.uid()) or (status <> 'DRAFT' and ((select auth_has_permission('executive_oversight.view_all')) or eo_rec_in_my_unit(id)))));

-- One addressed unit's record: the author; holders of view_all; the unit's own people (never while it is a draft).
create policy read_visible on eo_rec_targets for select to authenticated using (
  (select auth_aal_satisfied()) and (select auth_has_permission('executive_recommendation.view'))
  and ((status <> 'DRAFT' and ((select auth_has_permission('executive_oversight.view_all')) or business_unit_id = (select auth_bu()))) or eo_rec_is_mine(recommendation_id)));

-- Timeline entries and files follow their comment, or their recommendation and (when they belong to one unit) that unit's record.
create policy read_visible on eo_events for select to authenticated using (
  case when comment_id is not null then exists (select 1 from eo_comments c where c.id = comment_id)
       else exists (select 1 from eo_recommendations r where r.id = recommendation_id) and (target_id is null or exists (select 1 from eo_rec_targets t where t.id = target_id)) end);
create policy read_visible on eo_attachments for select to authenticated using (
  case when comment_id is not null then exists (select 1 from eo_comments c where c.id = comment_id)
       else exists (select 1 from eo_recommendations r where r.id = recommendation_id) and (target_id is null or exists (select 1 from eo_rec_targets t where t.id = target_id)) end);
-- A link is shown only to people who may read both what it hangs on and what it points at (a link never widens access).
create policy read_visible on eo_links for select to authenticated using (
  (case when comment_id is not null then exists (select 1 from eo_comments c where c.id = comment_id) else exists (select 1 from eo_recommendations r where r.id = recommendation_id) end)
  and (target_type not like 'SESSION%' or auth_eo_link_target_visible(target_type, target_id)));

-- ------------------------------------------------------------------ email: oversight events are optional emails (a person can switch them off in their preferences)
insert into email_event_types (event_type, mandatory, description) values
  ('EO_COMMENT_NEW',        false, 'An executive posted a comment about your business unit'),
  ('EO_COMMENT_REPLY',      false, 'Someone replied in an executive comment conversation you take part in'),
  ('EO_REC_NEW',            false, 'A recommendation was addressed to your business unit'),
  ('EO_REC_RESPONSE',       false, 'A business unit responded to your recommendation'),
  ('EO_REC_CLARIFICATION',  false, 'A clarification was requested or a follow-up question was asked on a recommendation'),
  ('EO_REC_DECISION',       false, 'A recommendation was accepted, partly accepted or declined'),
  ('EO_REC_UPDATE',         false, 'Implementation progress was reported on a recommendation'),
  ('EO_REC_DEADLINE',       false, 'The response to a recommendation is due soon'),
  ('EO_REC_OVERDUE',        false, 'The response to a recommendation is overdue'),
  ('EO_REC_CLOSED',         false, 'A recommendation was closed or withdrawn')
on conflict do nothing;

select lock_down_function_grants();
