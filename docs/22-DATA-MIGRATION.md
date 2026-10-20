# 4CORE-OKR Data Migration Specification

## Objective

Rebuild the application without losing valid current business data while removing hardcoded/demo/orphaned data.

## Migration phases

1. Inventory source database.
2. Inventory source application data.
3. Classify records as valid, invalid, demo, duplicate, obsolete, orphaned.
4. Map source entities to target entities.
5. Build transformation rules.
6. Create staging migration.
7. Reconcile counts and business facts.
8. Validate with sample-by-sample checks.
9. Run migration.
10. Reconcile target against source.
11. Obtain UAT/business sign-off.
12. Freeze and cut over.

## Preserve

Preserve validated:

- employees;
- users;
- BU membership;
- required strategy history;
- valid weekly reports;
- valid goals/tasks;
- valid scores where historical truth is established;
- violation history;
- valid financial history;
- audit evidence where available.

## Remove/Do not migrate

- fake/demo data;
- hardcoded dashboard values;
- orphaned records with no legitimate owner where policy says remove;
- obsolete legacy structures;
- duplicated records after approved reconciliation.

## Reconciliation

For every major entity compare:

- source count;
- target count;
- source total monetary value;
- target total monetary value;
- source references;
- target references.

Any unexplained discrepancy is a migration defect.

## Historical ownership

Historical weekly reports must preserve the BU that owned the report at the time. Do not derive historical ownership from a user's current BU after a transfer.

## Rollback

Every production migration must have a tested recovery strategy.

## Historical weekly reports (ADR-077)

Past weekly reports can be loaded by a Super Admin (`history.import`) through Administration → Historical reports: staged, rehearsed (real scoring, rolled back) and committed in one transaction. Scores are recomputed, never copied. Rules, refusals and open assumptions are in ADR-077 and docs/25 rows 78 to 85.
