# 4CORE-OKR DevOps and Reliability

## Environments

- Local/Development
- Staging/UAT
- Production

No shared secrets across environments.

## CI/CD gates

A deployment should fail when:

- build fails;
- typecheck fails;
- lint fails;
- required tests fail;
- critical security tests fail;
- migration checks fail;
- smoke tests fail.

## Database migrations

Every migration must be:

- version-controlled;
- reviewed;
- tested in staging;
- safely deployable;
- accompanied by data-impact assessment.

## Scheduled jobs

Required jobs include:

- reporting-week setup/open;
- Content Lock processing;
- Final Lock processing;
- quarter rollover/lock;
- non-submission detection;
- notifications;
- analytics refresh as needed.

Jobs must be idempotent and retryable.

## Scheduler principle

Authorization must not depend solely on job execution. The API checks server time/lifecycle independently.

## Monitoring

Monitor:

- API error rate;
- latency;
- database errors;
- RLS denials that indicate abuse;
- job failures;
- job latency;
- notification failures;
- financial transaction failures;
- unusual authentication patterns.

## Backups

Use automated backups and periodically verify restoration.

## Recovery

Define and test RPO/RTO with the organisation.

## Observability

Use correlation IDs across:

API → domain operation → DB transaction → audit event → notification.

## Reliability principle

External provider failure must not corrupt core transactions.

Examples:

- email failure must not roll back successful financial transaction;
- AI failure must not prevent weekly report submission;
- notification failure must be retried asynchronously.
