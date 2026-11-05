# 4CORE-OKR Financial Controls

## Currency

All amounts are NGN/₦.

## Financial source of truth

The financial ledger is authoritative.

Do not use a manually edited `balance` field as the sole source of truth.

## Inflow

Violation payment:

`Violation → Payment → Ledger CREDIT`

This must be atomic.

## Disbursement request

HR/Admin creates:

- amount;
- purpose;
- justification;
- requester;
- source fund.

## Finance decision

Finance reviews and either:

- APPROVES;
- REJECTS.

Rejection reason is mandatory.

Requester cannot approve own request.

## Approval vs disbursement

Approval does not necessarily equal cash release.

Recommended lifecycle:

`SUBMITTED → UNDER_REVIEW → APPROVED → DISBURSED`

or:

`SUBMITTED → UNDER_REVIEW → REJECTED`

## Balance protection

Before approval/disbursement:

`available_balance >= requested_amount`

This check must occur transactionally using current database state.

## Ledger

Entries are:

- CREDIT;
- DEBIT.

Entries are append-only.

Corrections use compensating transactions/reversals rather than destructive edits.

### Reversal workflow (ADR-059)

1. A person with `ledger.reversal.request` asks, with a reason, for one entry to be reversed.
2. A different person with `ledger.reversal.approve` approves or rejects (a rejection needs a reason).
3. Someone with `ledger.reversal.execute` who is not the requester posts it: a new entry of the opposite type, `source_type = REVERSAL`, referencing the original. The original is untouched, an entry can be reversed once, and a reversal cannot be reversed.
4. The reversal is refused if it would make the balance negative or take money committed to approved disbursements.
5. A Super Admin can do 1 to 3 in one step in an emergency, with a full reason and a fresh authenticator code; every user who can view the ledger is alerted and the audit action is distinct.

Reconciliation counts reversal entries on the ledger side: credits less reversal credits equal recorded payments; debits less reversal debits equal recorded disbursements.

## Money type

Use fixed-precision numeric PostgreSQL storage.

## Financial reconciliation

At all times:

`displayed balance = sum(credits) - sum(debits)`

Automated reconciliation must be available.

## Financial security tests

- self-approval denied;
- overdrawn approval denied;
- duplicate payment prevented;
- duplicate approval prevented;
- concurrent approvals serialized;
- audit present;
- ledger immutable.


## Additions after the closing pass (ADR-065, ADR-068)

- **Reversing a violation payment does not reopen the violation** (owner decision, ADR-086, supersedes ADR-065). The violation stays settled, the payment row stays immutable and is shown as reversed, and the fund still reconciles because the reversal is a compensating ledger entry. A violation is never paid twice.
- **Violation types and fines are changed by request.** HR, Admin and Super Admin may ask; a different Admin or Super Admin approves (or a Super Admin applies it in an emergency). A violation keeps the fine it was recorded with (`violations.fine_amount`), so a changed default never alters earlier violations.
- **Disbursement controls are unchanged.** A role may not be given both `disbursement.create` and `disbursement.approve` or `disbursement.disburse` by a role change (rule 3 of ADR-069).
