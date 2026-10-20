# 4CORE-OKR Master Documentation Package

This directory contains five consolidated master documents plus a decision/gap register:

1. `01-BRD.md` — Business Requirements Document
2. `02-PRD.md` — Product Requirements Document
3. `03-FRD.md` — Functional Requirements Document
4. `04-UI-UX-SPECIFICATION.md` — UI/UX Specification
5. `05-SRS.md` — Software Requirements Specification
6. `06-DECISION-AND-GAP-REGISTER.md` — conflicts, open decisions, proposed enhancements and traceability

## How to use this package
- Keep the original `mdfiles/` documents and skills as the detailed technical companion; they have not been deleted or overwritten.
- Treat these master documents as the consolidated overview and requirement index, not as a replacement for accepted ADRs or endpoint/schema-level specifications.
- Resolve P0 decisions before implementation. Update all five master documents, detailed companion docs and tests together when a decision is approved.
- Do not treat proposed enhancements as approved requirements until the product/business owner signs them off.
- Verify actual source code, live database schema, migrations, RLS policies and runtime behaviour. Documentation alone does not prove that a remediation is deployed or correct.

## Authority and change control
The existing `00-SOURCE-OF-TRUTH.md` and accepted decisions in `24-DECISIONS.md` remain authoritative according to their stated hierarchy. If a master document conflicts with a source file or accepted ADR, record the conflict in the decision register and reconcile it formally; do not silently choose a convenient implementation.


## Decision update — 2026-10-12
Finding 1 (integrity penalty arithmetic) is resolved. The approved rule is percentage-of-original-base, additive penalty rates applied once, zero floor, and two-decimal final score precision. See `06-DECISION-AND-GAP-REGISTER.md` and retained `24-DECISIONS.md` / `07-SCORING-ENGINE.md`.

## Decision update log

- **2026-10-12 — Finding 1:** confirmed additive percentage-of-original-base penalty model and two-decimal final score precision.
- **2026-10-12 — Finding 2:** approved immutable finalised roster with HR-initiated, independently approved attendance amendments; no fixed request deadline; request reason required, evidence optional; self-approval prohibited. DEC-002 in this master package summarizes the decision. The complete package records the technical details in `24-DECISIONS.md` (ADR-031). A separate rejection-reason control is proposed, not yet approved.

- **2026-10-12 — Attendance workflow clarification:** weekly roster defaults to PRESENT for every active staff member; HR toggles exceptions after the OKR session; Skip OKR atomically tags all staff VIRTUAL_PRESENT; skipping affects only the physical session; every BU must submit a weekly report with a manually authored performance summary and complete normal review; no absence violation is generated for skipped weeks, and no CANCELLED OKR outcome exists. See DEC-017.

## Decision update — 2026-10-13
Finding 3 Decisions 1–2 and the Organisation Holiday clarification are recorded in the master set and technical companion docs. Quarterly scoring includes every NORMAL or SKIPPED-session week and excludes each officially declared ORGANIZATION_HOLIDAY week. Missing reports in reportable weeks contribute zero unless an authorised exception applies; approved late reports can amend score through an audited versioned snapshot after quarter lock without generally reopening the quarter. A SKIPPED session still requires a report and a manually authored summary comment, and triggers notification to all BU Leads. Treatment of submitted-but-unreviewed reports remains open.
