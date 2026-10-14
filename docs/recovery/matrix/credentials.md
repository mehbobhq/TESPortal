# UI recovery matrix: Credentials

Original: `git show 'e4fa336^:app/companies/[id]/credentials/page.tsx'` (1258-line monolith, browser-local; kept unchanged as `app/companies/[id]/credentials/legacy-credentials.tsx`, the second tab of `LegacyWorkspaceGate`).
Restored: `src/restored/credentials/` (adapter + list/dialog + per-credential manager) mounted by `app/companies/[id]/credentials/page.tsx` as the canonical (first) tab.

Hard rule held throughout: **no secret value exists anywhere in the new code**. No input in the restored UI accepts a password, answer, PIN or code; no state holds one; no request carries one; the canonical inputs are strict (an extra key is refused) and no read returns a secret value or a secret-store reference. The original itself never persisted secrets (it blocked saving any), so this is not a regression.

## Component / file map

| Original | Current (before) | Recovered | Notes |
|---|---|---|---|
| `page.tsx` search box, category tabs (All, Fleet, Compliance, Registration, Insurance, Accounting, Fuel, Other), "Add credential" | simplified cards + two forms | `RestoredCredentials.tsx` (same layout, classes and copy) | filters are client-side over the canonical list, as in the original |
| Table: portal/system + legal name + services, category, masked username, recovery status, status badge, last verified, open-portal chevron | list rows with raw codes | same table. Added: a "Manage credential" icon beside the chevron, and a "Show archived" toggle | legal name and services are "not recorded" (no canonical field); legal name falls back to the linked provider company's name when one is linked |
| 2-step Add Credential dialog, step 1 (company/provider search, portal search, category, username, password, MFA) | plain form | same dialog | see control table |
| Step 2 Account Recovery (security questions, recovery methods email/phone/PIN/backup codes/MFA/other) | absent | same step, **declare-only** | each row declares a secret slot; banner says secrets live in the secret manager |
| "Add Company" iframe `/companies/new?context=credentials&embedded=1` + postMessage | absent | same iframe + same-origin postMessage listener | on the message the company list is re-read from the canonical directory and the new company selected |
| Portal registry (`PORTAL_REGISTRY` seeds ATIOS Alberta / TRACS Alberta + `tes_portal_registry_v1` custom portals) | `/api/credential-systems` select | portal search over canonical `credential_systems` (+ aliases) | the two seeds are **not hard-coded**: they would be fabricated records. They are created through the registry like any portal (see "Add portal / system" below) |
| `window.alert` for a portal without a login URL | n/a | inline notice | no browser dialog |

## Control classification

| Control (original label) | Class | Canonical operation / route | Status |
|---|---|---|---|
| List credentials | existing read | `getOrganizationCredentials` via `GET /api/companies/[id]/credentials` | done |
| Search, category tabs | UI only | n/a | done |
| Company / Provider search | existing read | `GET /api/companies` (ORGANIZATION_REGISTRY_READ) | done; Customer/Prospect kinds hidden as in the original; the current company is excluded |
| Add Company (iframe) | existing page | company creation (`POST /api/companies`, owned by the company workspace) | done |
| Portal / System search | existing read | `listSystems` via `GET /api/credential-systems` | done |
| Provider-less portal gets the chosen provider on first use | update | `updateSystem {providerOrganizationId}` via new `PATCH /api/credential-systems/[systemId]` | done; the original did the same to its registry entry |
| (added) "Add portal / system" when no portal matches | create | `createSystem` via `POST /api/credential-systems` (linked to the selected provider) | done. The original had no UI to create portals (seed + localStorage only), so without this the registry could never be populated; this is the one added control in the dialog |
| Category, Username | create | `createCredential` (`POST /api/companies/[id]/credentials`) | done |
| Duplicate-account guard | create | UI pre-check + domain rule (`findActiveAccount`) | done; server is authoritative |
| MFA / Authentication method (free text) | create / update | `mfaMethod` (closed vocabulary) | **changed control type**: free text cannot map to the closed list, so it is a select with the canonical values and "Not recorded" |
| Password field | **secret, never stored** | none | kept, shown disabled with the original label and an unavailable note. Saving records that a PASSWORD slot exists (created by `createCredential`); the value lives only in the secret manager |
| Save (credential) | create | new `createCredentialWithRecoverySlots` (one transaction: credential + declared slots) via `POST /api/companies/[id]/credentials` | done; status starts NEEDS_VERIFICATION as in the original; a refused slot rolls the credential back |
| Recovery status badge ("Not added / Partially added / Recovery added") | derived | from slot states: no live recovery slot = Not added; every live recovery slot STORED = Recovery added; otherwise Partially added | done. With no secret store integrated every declared slot is UNRESOLVED, so a declared set reads "Partially added" (honest) |
| Add question / Security question text / Answer | slot declare + **no column / secret** | `SECURITY_ANSWER` slot per question via `recoverySlots`; text has no column (approved decision) | question text and answer inputs are disabled with an unavailable note |
| Add recovery method: email / phone / PIN / backup codes / MFA recovery / other | slot declare | `RECOVERY_EMAIL`, `RECOVERY_PHONE`, `RECOVERY_PIN`, `BACKUP_CODES`, `MFA_SECRET`, `OTHER_RECOVERY` | done (declare only). Label and value inputs disabled with an unavailable note. Only one MFA recovery slot per credential (database rule), enforced in the UI draft |
| Open portal chevron | UI | portal `loginUrl` | done |
| (added) Change status / Correct status | lifecycle / correct | `changeCredentialStatus` (real change, history kept) and new scoped `correctCredentialStatus` (mistake flagged, kept) | done; the earlier canonical page offered only change |
| (added) Record verification / Void verification | create / void | `recordVerification`; new scoped `voidVerification` | done |
| (added) Category / MFA edit | update | new scoped `updateCredentialMetadata` | done; clearing an MFA method is not an operation (shown) |
| (added) Replace login (username) | create + archive | new scoped `replaceCredential` (USERNAME_CHANGED or CORRECTION) | done; the old credential is archived with history |
| (added) Declare / retire recovery item | slot declare / retire | new scoped `addSecretSlot`, `retireSecretSlot` | done |
| (added) Link secret-manager resource | link by name | new scoped `attachSecretReference` (UNRESOLVED -> STORED; accepts only a Secret Manager resource NAME) | done; the name is never returned or logged |
| (added) Archive / Restore | lifecycle | `archiveCredential`, `restoreCredential` | done |
| (added) Portal name / URL / alias / archive | system maintenance | `updateSystem`, `addAlias`, scoped `retireAlias`, `archiveSystem`, `restoreSystem` via `PATCH /api/credential-systems/[systemId]` | routes done; the manager UI exposes update, add/retire alias (archive/restore routes exist, no UI control yet) |
| Portal legal name, services | **no canonical field** | none | shown as "not recorded" + unavailable note; needs a decision if they should exist |

## Operations and routes implemented in this pass

All were already defined by migration 0018 and `lib/company-credentials/operations.ts`; none had a route or a company-scope guard.

* `lib/company-credentials/scoped-operations.ts` (pure, no authorization wrapper): checks that the credential / slot / verification / period belongs to the Organization in the URL (mismatch = not found), then calls the existing operation in the same transaction. Master Register events are the operations' own.
* `lib/company-credential-scope/service.ts`: the one `CREDENTIAL_MANAGE` wrapper for those entry points. It is a separate module on purpose: `lib/company-credentials/service.ts` is pinned by an existing test to exactly the designed function list, so it was left untouched.
* Routes: `PATCH /api/companies/[id]/credentials/[credentialId]` gained `correctStatus`, `voidVerification`, `metadata`, `replace`, `declareSlot`, `retireSlot`, `linkSecret`; `POST /api/companies/[id]/credentials` accepts `recoverySlots` (kinds only) and ignores any body `organizationId`; new `GET/PATCH /api/credential-systems/[systemId]`. The system registry is global (a system belongs to no company), so those routes are not under `/api/companies/[id]`.

## Not done / missing

* Security-question TEXT and recovery-method LABELS: missing domain (approved decision: no column). UI keeps the controls, disabled, with a note.
* Portal legal name and service list: missing domain field; decision needed.
* Secret values (password, answers, PIN, codes): intentionally never stored. A secret-store integration (slot UNRESOLVED -> STORED by an out-of-band process) is a separate approved workflow; the "Link secret-manager resource" control only records a resource name.
* Archive/restore portal has routes but no restored-UI control.
* No browser verification was done in this pass (coordinator).

## Verification

`test/lib/ui-recovery/credentials-business.db.test.ts` (real authorization, runtime role):
* "credential operations are reachable only through the credential's own company and leave other companies untouched" (isolation for every scoped operation, correction flagged and kept, void kept, retired slot kept, replace archives the old login, Master Register event per operation, alias scoped to its system)
* "no secret value exists anywhere: strict inputs, value-free responses, events and columns" (unknown keys such as password/secret/answer/pin refused by service and route; a value is not accepted as a reference and is not echoed; the linked resource name and any value are absent from responses and Master Register rows; no value-capable column exists)
* "a credential and its recovery slots are created in one transaction, always under the URL company" (body organizationId ignored; bad slot kind or a second MFA slot leaves no orphan credential)
* "a Master Register failure rolls the whole change back"
* "authorization: reading and managing are separate, and a signed-out caller can do neither"

Static: `test/lib/ui-recovery/restored-ui-boundaries.test.ts` (no browser storage, no legacy store, transitive), `test/lib/phase-de/phase-de-cutover-boundaries.test.ts` (page: `fetch(`, "deferred", no password input, no secret terms), `test/lib/company-credentials/company-credentials-boundaries.test.ts`.
