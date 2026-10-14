# Contacts workspace: UI recovery matrix

Route: `app/companies/[id]/contacts`. Original snapshot: `2644183` (components in `src/components/contacts/*`, no diff since).
Restored UI: `src/restored/contacts/**` (copies of the original components, adapted), wired to `lib/contacts` through
`src/restored/contacts/adapter.ts` and `/api/companies/[id]/contacts` (dispatch: `lib/ui-recovery/contacts-actions.ts`).
The browser-local original (`LegacyContactsPage`, `tes_contacts_v5`) is untouched and remains the second tab.

## Honest mapping of original concepts

| Original | Canonical home | Note |
|---|---|---|
| Person, first/last name | `persons` + `person_name_versions` | Name edit is a real-world change (`changeName`) or a correction (`correctName`), chosen in the Edit form. |
| Company relationship | `organization_person_relationships` | One displayed contact per person; a restored contact has a NEW relationship, the ended one stays in history. |
| Role (`STANDARD_ROLES`) | `organization_person_titles` (free text, with history) | The role text is recorded as the title. Roles are NOT mapped to purposes (no invented semantics). A non-standard canonical title stays selectable. |
| Primary Contact (star, checkbox) | `contact_purpose_assignments`, purpose `PRIMARY` (single per company) | `makePrimary` demotes the incumbent in the same transaction; un-star = `endPurpose`. The role "Primary Contact" is only a title. |
| Phone / Email | `person_channels` (PHONE / EMAIL) | add / change / correct / end / void. |
| Archived / Restore | relationship ended (+ `archivePerson` when no other relationship is open) / `restorePerson` + `addRelationship` + title re-recorded | Purposes (incl. Primary) are deliberately not re-assigned on restore; stated in a notice. Person still a contact elsewhere: person stays active, reported as a notice. |
| Date of birth, driver licence #/jurisdiction/expiry/issue/class/restrictions | none (driver domain; no contact home) | Shown as "Not recorded"; entering a value REFUSES the whole save (`CanonicalOperationUnavailableError`) before anything is written. |
| Notes | none | Same refusal. |
| Evidence, OCR, camera | none (legacy OCR retired; contacts have no evidence link) | UI kept; OCR starts with empty fields (no fabricated extraction), "Confirm & Save Identity" refuses and nothing is stored; document is shown in memory only. |
| Revision Events | derived from recorded canonical history (names, channels, titles, purposes, relationship, archive) | Corrected/voided rows are shown as "recorded in error". Master Register events are not read by the UI (no read route). |
| Associated Companies | this company's relationships only | Other companies are not loaded (note in the inspector). |
| Store schema tile `tes_contacts_v5 (Locked)` | now "TES database (PostgreSQL)" | |

## Component matrix

| Original component | Current (pre-recovery) | Recovered | Controls restored | Canonical operations connected | Missing (exact gap) | Verified by |
|---|---|---|---|---|---|---|
| `ContactStats` | simplified 3-count row | `src/restored/contacts/ContactStats.tsx` | Active Personnel, Primary Contact, Verified Credentials, Store tiles | read | Verified Credentials is always 0 and says evidence is not recorded (missing domain link) | boundary + tsc; coordinator visual |
| `ContactDirectory` | simplified list | `ContactDirectory.tsx` | search (name/role/email/phone), role filter, include archived, primary star, row select, Add First Contact | read; `makePrimary` / `endPurpose` via the star | licence search/column: no data (shown "Not recorded") | tests 3, 4 (adapter plans), tsc |
| `ContactInspector` | `<details>` Edit form | `ContactInspector.tsx` | edit (names, phone, email, role, primary, licence/DOB fields), archive/restore, evidence list, events, associated companies; added: change-vs-correction choice, contact purposes panel | `changeName`/`correctName`, `addPersonChannel`/`changePersonChannel`/`correctPersonChannel`/`endPersonChannel`/`voidPersonChannel`, `addTitle`/`changeTitle`/`correctTitle`/`endTitle`/`voidTitle`, `makePrimary`, `endPurpose`, `assignPurpose`, `endRelationship`, `archivePerson`, `restorePerson`, `addRelationship` | DOB / licence / notes: missing domain (driver record) -> refused; evidence attach/preview: missing evidence link -> unavailable note | tests 3, 4, 5, 6, 7 |
| `ManualContactDialog` | "Add a contact" form | `ManualContactDialog.tsx` | all original fields incl. DOB + licence + notes inputs, role select, Primary checkbox; added: advisory duplicate list with "Use this person" | `createContact` (name, title, PRIMARY purpose, channels in ONE transaction), `findMatches` (advisory), `addRelationship` | DOB / licence: refused before anything is written | tests 1, 2, 11 |
| `ContactDocumentIntake` | none | `ContactDocumentIntake.tsx` (+ shared `DocumentSourcePicker`, `CameraCapture`) | Document / OCR button, source picker, camera capture | none (file read in memory only) | extraction retired; no storage | static boundary test |
| `ContactOCRWorkspace` | none | `ContactOCRWorkspace.tsx` + `viewer/SecureDocumentViewer.tsx` (copy without browser audit log / storage) | split view, field review, role, Primary | none | Save refuses (no licence fields, no evidence link) | static boundary test |
| `ContactEvidenceViewer` | none | `ContactEvidenceViewer.tsx` | preview modal | none | no stored evidence exists to preview | static boundary test |
| (new, from the canonical page) company lines | `CanonicalContacts` card | `CompanyLinesCard` in `RestoredContacts.tsx` | add / end company phone and email lines with usage | `addChannel`, `endChannel` | none | test 11 |
| main page `LegacyContactsPage` | browser-local | `RestoredContacts.tsx` | header, banners, deep link `?contact=` | read, all of the above | | all |

## Classification of every restored control

Existing canonical read: directory, stats, inspector, events, company lines. Create: Manual Add. Update/correct: Edit (name, phone, email, role). Lifecycle: Archive, Restore, Primary, purposes, end title/channel/line. Approved domain with an unrouted operation (now routed, no domain change): `addRelationship`, `changePersonChannel`, `correctPersonChannel`, `voidPersonChannel`, `changeTitle`, `correctTitle`, `voidTitle`. Missing canonical domain requiring a decision: contact DOB/licence/notes (driver domain), identity evidence/OCR (no contacts-evidence link).

No new migration, no new domain operation, no capability or policy change. New code: routing dispatch `lib/ui-recovery/contacts-actions.ts`.

## Verification

"Test N" numbers refer to the cases of `test/lib/ui-recovery/contacts-settings.db.test.ts` in file order: 1 Manual Add mapping, 2 licence/DOB/notes refusal, 3 change vs correction, 4 single Primary, 5 archive/restore, 6 multi-company archive, 7 partial failure, 8 company isolation, 9 authorization, 10 rollback, 11 company lines + advisory matches.
`test/lib/ui-recovery/contacts-settings.db.test.ts` (real authorization, runtime role, real Master Register): Manual Add mapping + events; licence/DOB/notes refusal writes nothing; change vs correction history (name, phone, role); single Primary; archive/restore (no duplicate contact, person kept); archive of a multi-company person; partial-failure reporting per step; company isolation (7 cross-company targets rejected, body company ignored); authorization (reader denied, no events); rollback on a refused Master Register write; company lines + advisory matches.
Static: `test/lib/ui-recovery/restored-ui-boundaries.test.ts` (no browser persistence transitively).

## Not done / for the coordinator to verify visually

- Visual check of the restored layout, the added Contact Purposes panel, Company lines card and the change/correction fieldset.
- "Other companies" for a person and Master Register event display are not available in the UI.
- Evidence viewer/OCR cannot be exercised end to end (nothing can be stored by design).
