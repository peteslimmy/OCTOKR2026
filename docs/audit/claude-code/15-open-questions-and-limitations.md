# 15 — Open questions and limitations

## Disclosure that affects how to read this audit
1. **Fixes made before the audit instruction.** In the same session, earlier, I changed application code, added three migrations and tests, rebuilt the quote workflow, split the UI primitives, and rewrote the evidence routes (F-002, F-003, F-004, F-020 and repairs behind F-006). I also reset and restored the local database and ran `org:restore`. These are uncommitted. The audit does not claim they are independently reviewed. Anything marked *remediated* needs a second pair of eyes and a regression test.
2. **Audit-only from the instruction onward:** after the instruction I changed no application code, schema or data; I created `docs/audit/claude-code/*` only. Read-only database queries and unauthenticated probes were used. I did sign in as the Super Admin and loaded pages (read-only, apart from the earlier add/delete-unit demonstration which preceded the instruction).
3. **The owner's real data was already lost (F-001) before the audit.** The database examined holds the organisation rebuilt from `organisation.json` plus the Q4 2026 quarter created earlier in the session.

## Limitations
- One account (Super Admin). No other role's view or permissions were exercised.
- No reporting week exists, so no weekly workflow, score, lock, review, quote or violation flow was run in the application.
- The development server was used; no production build, no hosted environment, no real email/webhook/tracing endpoint.
- The Playwright suite, API HTTP suite and concurrency suite were not run (the last resets the database).
- The sibling folders `../spec/OKRDOCUMENTATION` and `../spec2/mdfiles` were located but not read; `docs/` was read selectively (scoring, API contract, ADRs 78–84, gap plan).
- Colour contrast, keyboard/focus order, screen-reader output, mobile layout and charts were not assessed.
- The 65 service-only definer functions and the import-file parsers were not reviewed line by line.
- No exploit-level security testing; no secret scan beyond reading; `npm audit` only.

## Questions for the owner
1. Q4 2026 objective, key results and Sub-KRs (pending; needed for F-022 and Phase 2).
2. Keep, change or remove report rejection and the quote workflow (F-009)? May a published quote be replaced?
3. May a Business Unit be a child of a Department (and vice versa)? Should hierarchy affect scoring or reporting?
4. Gap plan C4 (is the history sheet's week the ISO week?) and C8 (who holds Manager/Member/Viewer).
5. Should a rejected report be reopenable by its BU Lead, or is rejection purely informational?
6. Where will the application be hosted, and which email provider and trace collector will be used?
7. May I commit the working tree locally (no push) to give it history?
8. Is the supplied Super Admin password a throwaway for this local environment? It was shared in chat and should be changed.

## Requirement conflicts
`docs/33` vs the code (resolved in this session); `IMPLEMENTATION_COMPLETE.md`/`docs/38` vs the code (F-006); `docs/12` says no mandatory reviewer comment for attendance amendments while ADR-083 invents a mandatory rejection reason for reports (not contradictory, but inconsistent policy).
