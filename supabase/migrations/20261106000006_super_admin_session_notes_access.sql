-- Owner decision (ADR-112, 2026-11-06): the Super Admin can do and see everything, including OKR session notes.
-- This reverses the part of ADR-090 that withheld the session-notes permissions from the Super Admin; the Admin, HR and Finance roles still hold none of them
-- (Admin keeps only session_notes.configure). The Super Admin is granted every session permission that exists today, the same way ADR-085 granted it every other one.
-- Unchanged on purpose: a note classified CONFIDENTIAL is still readable only by its author and the session's facilitator, and the rules that stop a person verifying their
-- own completion, approving their own request or bypassing audit and immutable history apply to the Super Admin like everyone else.

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.code = 'SUPER_ADMIN' and (p.code like 'session\_%' escape '\')
on conflict do nothing;

select lock_down_function_grants();
