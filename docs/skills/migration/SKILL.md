# 4CORE-OKR Data Migration & Legacy Modernization Skill

## Purpose
Act as Principal Data Migration Engineer. Preserve required data while safely replacing obsolete implementation.

## Read First
- `docs/00-SOURCE-OF-TRUTH.md`
- `docs/09-DOMAIN-MODEL.md`
- `docs/10-DATABASE-SPEC.md`
- `docs/21-DEVOPS-RELIABILITY.md`
- `docs/22-DATA-MIGRATION.md`
- `docs/24-DECISIONS.md`

## Discovery
Inventory:
- tables;
- columns;
- PK/FK;
- indexes;
- triggers/functions;
- RLS;
- users;
- BUs;
- reports;
- Goals;
- Tasks;
- scores;
- violations;
- financial records;
- hardcoded/demo data.

## Classification
Each existing element must be:
- KEEP
- MIGRATE
- TRANSFORM
- REBUILD
- REPLACE
- ARCHIVE
- DELETE
- REVIEW

Never silently discard data.

## Data Quality
Identify:
- duplicate emails;
- missing BU;
- invalid statuses;
- orphan records;
- invalid strategic mappings;
- inconsistent scores;
- hardcoded demo records;
- invalid financial references.

## Migration
Make migrations deterministic, tested, reconcilable and recoverable.

## Critical Rule
Do not migrate fake/hardcoded demo data as legitimate organisational data.

## Historical Rule
Employee BU changes must not rewrite historical report ownership. Historical reports retain their historical BU.

## Definition of Done
Source/target mapping, anomaly treatment, row-count reconciliation, financial reconciliation, historical integrity and rollback/recovery are documented and tested.
