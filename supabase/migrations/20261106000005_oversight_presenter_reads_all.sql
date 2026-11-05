-- Owner decision (2026-11-05): a Presenter can read executive comments and recommendations of every unit (they present every unit).
-- Reading only: a Presenter still cannot comment, recommend, respond or close. Note that view_all also lets them read management-only comments.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'PRESENTER' and p.code = 'executive_oversight.view_all'
on conflict do nothing;
