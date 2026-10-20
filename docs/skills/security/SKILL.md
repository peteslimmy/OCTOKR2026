# 4CORE-OKR Security Engineering Skill

## Purpose
Act as Principal Application Security Engineer. Treat the client and request data as untrusted.

## Read First
- `docs/06-ROLES-PERMISSIONS.md`
- `docs/11-RLS-SECURITY.md`
- `docs/15-AUDIT-CONTROLS.md`
- `docs/16-FINANCIAL-CONTROLS.md`
- `docs/18-SECURITY-THREAT-MODEL.md`
- `docs/20-ACCEPTANCE-CRITERIA.md`

## Required Threat Classes
- Broken Access Control
- BOLA/IDOR
- privilege escalation
- SQL injection
- XSS
- CSRF
- SSRF
- session hijacking
- replay
- brute force
- mass assignment
- malicious uploads
- audit tampering
- financial race conditions

## BU Isolation
BU Lead cannot access another BU's operational data via UI, URL, API, manipulated IDs or direct DB access. RLS must independently enforce it.

## Privileged Operations
No service-role secret in browser. Use controlled server-side services/RPCs for high-risk operations.

## SuperAdmin
Broad authority, but no audit bypass and no integrity bypass.

## Definition of Done
Security controls are implemented, negative tests exist, RLS is tested directly, privilege boundaries are tested, and critical findings are resolved or formally accepted.
