# Administrator guide

For Admins, Super Admins and the people who approve their requests. Technical operation (hosting, scheduler, backups, monitoring) is in `27-DEPLOYMENT-AND-OPERATIONS.md`; account recovery is in `26-ACCOUNT-RECOVERY.md`.

## The idea in one paragraph

Settings that change how the organisation is governed are never changed by one person alone. One person **asks** (with a reason), a **different** person **approves**, and only then does the change happen. Everything is recorded in the audit log. In a real emergency a Super Admin can apply a change alone; that needs a reason, a fresh authenticator code, and everyone who approves is alerted.

## First set-up, in order

1. **Sign in as the first Super Admin** (created by `npm run bootstrap`), set up the authenticator app and keep the ten recovery codes safe.
2. **Appoint a second person who can manage roles** (Administration → Users and roles). The page warns while fewer than two people can.
3. **Add Business Units** (Administration, or Import Business Units) and **people** (Add user, or Import employees). Give each person a role; the person sets their own password from the link.
4. **Check the roles** (Administration → Roles) match your organisation; create or change them as needed (below).
5. **Set the lock times** if the standard ones (content lock Tuesday 18:00, final lock the following Tuesday 11:00, Lagos time) are not right (below). Do this **before** you activate the first quarter: weeks are generated when a quarter is activated and a generated week never changes.
6. **Create the strategy** (annual theme, quarterly objectives, key results, Sub-KRs), then **activate the quarter**. From then on, changes to its strategy are requests too.
7. **Violation types and the penalty rate** (Governance → Violations, Administration): add the types management agreed and the fine for each.
8. **Reminders and email** (Administration): set when reminders go out. Without an email provider reminders still appear in the application.

## Asking for a change and approving one

- Open the place where the setting lives (Roles, Lock times, Reminders and email, Data retention, the penalty rate, a Business Unit's weekly reporting, Add violation type). Fill in the new values and a **reason**. The request is checked straight away with the same rules that will apply it, so a request that could never work is refused with a plain message.
- **Administration → Approvals** lists what is waiting, what each change is from and to, who asked and why. Someone other than the person who asked opens it, reads the table, and chooses **Approve** (it is applied at once) or **Reject** (a reason is required, and the requester is told).
- The person who asked can **withdraw** a request while it waits. Only one request can wait for the same thing at a time.
- Changes that touch **protected** settings (see below) show "a Super Admin must decide it" to everyone else.

## Roles

A role is a name and a set of permissions. Administration → Roles lists them with how many people hold each.

- **New role:** code (capital letters, digits, underscores), name, description, tick the permissions, say whether people with the role must use an authenticator app, give a reason.
- **Edit** a role the same way. The code cannot change.
- **Delete** a role: if people hold it you must choose another role to move them to.
- You can give a role **only permissions you hold yourself**; the others are greyed out.
- **Protected permissions** (marked in the list: managing roles and users, the audit log, money approval and release, emergency overrides, penalty rate, approving configuration) and the **authenticator requirement** can be added or removed only with a Super Admin's approval and a fresh authenticator code.
- A change cannot put "ask for money" and "approve or pay it" on the same role, or "ask for an attendance amendment" and "approve it". These pairs are listed in `permission_conflicts`.
- The system will not let the **last people who can manage roles** be removed, by deleting a role or stripping its permissions.
- To give someone a role, use Administration → Users and roles → Roles. Handing out a role that can administer people or roles needs the role-management permission.

## Lock times

Administration → Lock times shows the schedule in force and its history. To change it, choose the day, time and which week for the **content lock** (goals and tasks freeze) and the **final lock** (the week is scored), give a reason and send it for approval.

- It applies only to weeks **generated after** it is approved. A week that already exists keeps its times for ever, so changing the times never moves a deadline someone is working towards. Weeks are generated when a quarter is activated, so a change takes effect from the next quarter to be activated; the screen names the first week affected.
- The week always starts Monday 00:00 Lagos time; that and the time zone cannot be changed.
- Reminders, the weekly page and the dashboard read the stored times, so they follow the change by themselves.

## Violation types

Governance → Violations → Add violation type (HR, Admin and Super Admin can ask; a different Admin or Super Admin approves). A changed fine applies to violations recorded afterwards; earlier violations keep the fine they were recorded with.

## Data retention

Administration → Data retention: how many months read notifications are kept (default 12) and how many days finished emails are kept (default 90). Anything unread, and every audit, score, ledger, report and violation record, is kept for ever.

## Integrations (email, AI, webhooks)

Administration → Integrations. Each kind has its own form; the page lists what is set up, whether it is in use, and how its last test went.

- **Add** an email service, an AI provider or a webhook: fill in the form, press **Test these values** (a test message goes to your own address; nothing else is sent), then **Send for approval**. A **Super Admin** approves integrations, because changing where email or events go is a way to take data out. Until then nothing changes.
- **Secrets** (passwords, API keys, signing secrets) are encrypted as soon as you send them and are never shown again, not even to the approver. To change one, type a new value; leave it empty to keep the saved one; tick "Remove" for an optional one.
- **Email:** one service is in use at a time and it replaces the server's own settings. If the page says "Passwords and API keys cannot be saved yet", the person who runs the server must set `INTEGRATIONS_ENCRYPTION_KEY`.
- **AI provider:** the connection is stored and tested. No part of the application sends data to an AI provider yet; when one does, it will use the one you configured here.
- **Webhooks:** choose which events (`*` for all, a name such as `ROLE_CREATED`, or a prefix such as `CONFIG_CHANGE_*`) and a format. Each delivery says what happened and to what (never the old or new values, never the reason), signed with your signing secret so the receiver can check it. For Slack or Microsoft Teams, use their incoming-webhook address and the **TEXT** format. The card shows how many events are waiting and how many failed.
- **Test** on a saved integration checks it with the saved secret. Switching one off keeps all its settings and secrets.
- Addresses must be public https addresses; the application refuses addresses inside your network.

## The audit log

Audit (menu): filter by action (for example `ROLE_` shows every role event), entity type, outcome (success, denied, failure), dates, or an entity id or words from the reason. **Export CSV** downloads what the filter shows (up to 10,000 rows); the export is itself recorded.

## When something looks wrong

- **Nobody can sign in with their authenticator:** `26-ACCOUNT-RECOVERY.md`.
- **A deadline did not behave as expected:** check Administration → Lock times for the version that governed that week, and the audit log for `LOCK_SCHEDULE_CHANGED`.
- **Reminders or emails are not arriving:** Administration → Reminders and email shows whether a provider is configured and the queue; the operator can read `/api/internal/health`.

## Historical reports (Super Admin only)

Administration → Historical reports loads past weekly reports from a spreadsheet so earlier quarters appear in scores, trends and reports.

1. **Prepare the sheet.** One row per goal: Year, Week, BU/Depart (a unit's code or name), SubKR (for example 1.1; empty for a stretch goal), Goal, then Task 1 / Status 1, Task 2 / Status 2 and so on. Status is Done or Not Done. A blank Year, Week or BU cell repeats the row above. The Business Units must already exist.
2. **Choose the file.** Every problem is listed with its spreadsheet row; nothing is saved until the file is clean. Weeks of quarters that have ended can be loaded, and so can weeks of the active quarter once the week has closed (its Sub-KRs must already exist; the running quarter is never locked or given placeholder strategy), and a week the application already closed or a unit that already has a report for the week is refused.
3. **Rehearse.** The application runs the real import and the real scoring, shows the recomputed quarterly scores, then undoes everything. Decide whether weeks without rows should be scored as missed reports.
4. **Import.** Type `IMPORT HISTORY` and confirm with your authenticator code. No second person approves it. Make sure the database backup is recent: the application never deletes reports, so this cannot be undone from here.

Nobody is notified and no email or webhook is sent during an import. Quarters that were never in the application are created as closed quarters with placeholder strategy text marked "historical, imported". Reports are recorded as submitted and reviewed.

## Roster, strategy import and sign-in import

- **Attendance roster:** Administration, People, Everyone lists every employee with and without a sign-in. "Take off roster" removes a person from new attendance rosters (they keep their sign-in); "Put on roster" reverses it. Rosters already created are not changed.
- **Import strategy (Super Admin):** Administration, Import, Strategy. One row per Sub-KR: Year, Quarter, Objective, KR, KR title, Sub-KR, Sub-KR title. It fills quarters that have no strategy and are not active; an ended quarter is stored locked, any other planned (activate it as usual). Type IMPORT STRATEGY and confirm with your authenticator code. An active quarter is changed by an approved request instead.
- **Import sign-ins and roles:** Administration, Import, Sign-ins and roles. Two columns: Email and Roles. The people must already be employees (Import employees first). Each gets a one-time set-password link, shown once; download the file and send each person their own link. Roles with administration rights need the permission to manage roles.
