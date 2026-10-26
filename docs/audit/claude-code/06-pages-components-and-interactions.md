# 06 — Pages, components and interactions

Method: signed in as Super Admin (second factor set up by the owner), loaded every reachable `(app)` page, checked for the Next.js error overlay and console errors, read page text, exercised one create/delete flow, ran a DOM accessibility probe on two pages, took dev-mode timings. **One role only** was available; role-specific views (BU Lead, HR, Finance, Executive, Presenter) were not seen.

## Pages loaded without error (33 of 42 page files; the rest are dynamic or role-specific)
`/dashboard, /strategy, /governance, /governance/violations, /governance/amendments, /governance/late-reports, /finance, /finance/ledger, /performance, /presentation, /notifications, /reports, /reports/builder, /reports/insights, /reports/metrics, /reports/saved, /audit, /admin, /admin/approvals, /admin/branding, /admin/calendar, /admin/import, /admin/import/{business-units,history,sign-ins,strategy}, /admin/integrations, /admin/people, /admin/roles, /admin/settings, /admin/site, /admin/units, /account/security`. Not loaded: `/weekly` and `/weekly/[reportId]` (no report exists), `/governance/sessions/[id]`, report/violation detail pages.

## Findings
- **F-004** `/admin/units` crashed (500) until `primitives.tsx` was split; the same module feeds most pages, so the regression risk was wide. After the fix all listed pages rendered.
- **Add unit dialog** had no parent/description/location although the page displays them: phase D was unusable from the screen. Fields added and tested live (create, display, delete).
- **React key warning** on the nested unit list (fixed) and a non-functional "▼ click to expand" marker (relabelled; there is no expand/collapse).
- **F-018** 18 identical "Delete" buttons (and repeated toggles) on the Units page have no row context for screen-reader users.
- **Unit hierarchy display:** a child is rendered only beneath its parent, so a Business Unit placed under a Department disappears from the Business Units section. Needs a decision (report 04).
- **Dashboard** shows "13 Business Units" ranked with `N/A` because no week exists; correct but gives a new user no hint that Q4 strategy is missing (the Strategy page does).
- **Dev-only noise:** a 401 console error on the dashboard came from an earlier failed sign-in, not from the page.

## Accessibility probe (dashboard, units)
`lang="en"`, one `h1`, no heading-level skips, one `main`, one `nav`, a skip link present, 0 unnamed buttons/links, 0 unlabelled inputs, 0 images without `alt`, no positive `tabindex`. Only F-018 found. **Not measured:** colour contrast, keyboard traps and focus order in dialogs, zoom/reflow, screen-reader output, charts, touch targets, reduced-motion behaviour.

## Interaction coverage
Exercised: Add unit (open, fill, create, close), Delete unit (confirm with reason), Create 2026 quarters (created Q4 2026), sign-in. **Not exercised:** all other buttons, filters, exports, uploads, bulk actions, tabs. They are listed as outstanding in report 16.

## Component notes
`primitives.tsx` (server-safe) and `primitives-radix.tsx` (client) are now separated; `src/components/ui/table.tsx` has 8 `any` types; `sub-kr-contribution-card.tsx` now uses the shared `apiRequest`; `quote-banner.tsx` is now server-rendered and renders nothing when no quote is published.
