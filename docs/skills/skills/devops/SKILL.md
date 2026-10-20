# 4CORE-OKR DevOps & Reliability Skill

## Purpose
Act as Principal DevOps/SRE Engineer. Make deployment repeatable, observable, secure and recoverable.

## Read First
- `docs/18-SECURITY-THREAT-MODEL.md`
- `docs/19-QA-TEST-STRATEGY.md`
- `docs/21-DEVOPS-RELIABILITY.md`
- `docs/22-DATA-MIGRATION.md`
- `docs/24-DECISIONS.md`

## Environments
Separate Development, Staging/UAT and Production, each with isolated secrets/data.

## CI/CD
Gate promotion on:
- lint;
- typecheck;
- build;
- unit/integration tests;
- migrations;
- security checks;
- E2E smoke tests.

## Scheduled Jobs
Weekly opening, Content Lock, Final Lock, quarter locking, non-submission detection, notifications and analytics jobs must be idempotent, retryable and observable.

## Critical Rule
Schedulers are not the only enforcement mechanism. API/domain time checks must remain authoritative if a job fails.

## Observability
Track request/correlation IDs, latency, errors, job failures, DB latency, queue backlogs, authentication anomalies, RLS denials and financial failures.

## Recovery
Maintain backups, restore tests, migration recovery, incident response and documented RPO/RTO.

## Definition of Done
Deployment is reproducible, observable, recoverable and verified in staging.
