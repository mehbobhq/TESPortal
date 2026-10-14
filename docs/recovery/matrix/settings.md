# Settings (Compliance Profile) workspace: UI recovery matrix

Route: `app/companies/[id]/settings`. Original snapshot: `2644183`. Restored UI: `src/restored/settings/**`
(`RestoredSettings.tsx`, `rules.ts` verbatim rule copy, `sections.ts` verbatim navigation), wired to `lib/company-profile` through
`src/restored/settings/adapter.ts` and `/api/companies/[id]/settings` (dispatch: `lib/ui-recovery/settings-actions.ts`).
The browser-local original (`LegacySettingsPage`, `tes_company_compliance_settings_<id>`) is untouched and remains the second tab.

## Honest mapping

| Original | Canonical | Note |
|---|---|---|
| Rule: Applies / Doesn't apply | `setRuleApplicability` (first assertion or real-world change) | |
| Rule: Not configured | absence of an assertion; saving it from a recorded answer = `clearRuleApplicability` (history kept) | A catalogue default (APPLIES) is NOT an assertion: the rule shows "Not configured" with a note that TES assumes it applies until answered. |
| 45 rules, six sections | `RULE_DEFINITIONS` (all 45 original ids are the lower-case codes; asserted in test 12) | |
| Jurisdiction (derived from the company region, never saved) | operating scope (`setOperatingScope`) recorded only when chosen, new "Operating scope" card in Profile overview | With no scope recorded no rule is greyed out; the region is never guessed. |
| Minimum age / experience (defaults 21 / 24) | `setDriverRequirements` (both together) | Defaults are NOT canonical: shown empty / "Not recorded". Bounds follow the domain (16-100 years, 0-600 months). |
| Draft + Save All, Discard, "Saved at" chip, unsaved confirm | draft in memory; "Save profile" = batch of canonical operations, one per changed item, each its own transaction and Master Register event | Per-item results; failed/refused items stay in the draft and are listed (not one transaction, stated in the UI). `beforeunload` guards leaving with unsaved changes (the original's Back confirm was never wired to a control). |
| (none) change vs correction | `correctOperatingScope` / `correctRuleApplicability` / `correctDriverRequirements` | Choice shown only when the save touches a recorded fact: "real-world change" (default) or "correction". |
| Company master facts (country, province, region) | `/api/companies/[id]/profile` (`regCorpCountry`, `regCorpState`, `opRegion`) | "Not recorded" when empty; "could not be loaded" on failure. |

## Component matrix

| Original | Current (pre-recovery) | Recovered | Controls | Canonical operations | Missing (exact gap) | Verified by |
|---|---|---|---|---|---|---|
| Section nav + coverage card | none (one long form) | `RestoredSettings.tsx` + `sections.ts` | six sections, Profile coverage n / 45 | read | | tsc; coordinator visual |
| Profile overview (facts, how-it-works, why) | none | `RestoredSettings.tsx` | master facts, explanatory cards, new Operating scope radio | read, `setOperatingScope`, `correctOperatingScope` | | test 14 |
| Rule rows (45) | Applies / Does not apply / Clear buttons per rule (each saved immediately) | `RuleRow` + `rules.ts` | radio trio, region greying, descriptions | `setRuleApplicability`, `clearRuleApplicability`, `correctRuleApplicability` | correction -> Not configured: missing operation (refused, "use a real-world change") | tests 13, 14, 15 |
| Driver requirements card | separate small form | `RestoredSettings.tsx` | min age, min experience | `setDriverRequirements`, `correctDriverRequirements` | clearing recorded minimums: missing operation (refused) | tests 13, 15 |
| Save area (Unsaved changes, Discard, Save profile, success bar, Saved chip) | none | `RestoredSettings.tsx` | all, plus change/correction fieldset, per-item failure list | batch via `runPlan` | atomic all-or-nothing save is not offered (per-fact operations) | tests 13, 15, 16 |

## Security / isolation

- Company always from the URL (`organizationId: id`); correction operations take a period id only, so the dispatch first checks the period is in THAT company's recorded history (`assertPeriodBelongs`), otherwise "not found" and nothing changes.
- Capabilities unchanged (`COMPANY_PROFILE_READ` / `COMPANY_PROFILE_MANAGE`); no migration, no new operation, no policy change.

## Verification

"Test N" numbers refer to the cases of `test/lib/ui-recovery/contacts-settings.db.test.ts` in file order: 12 unconfigured company, 13 batch save, 14 change/correct/clear history, 15 partial failure, 16 isolation + authorization + rollback (1-11 are the Contacts cases).
Settings cases: unconfigured company shows Not configured / Not recorded (no 21/24, 45 rules); batch save with Master Register events and reload; change keeps history, correction flags, clear keeps history, correction cannot clear (refused, nothing written); partial failure (saved + refused + failed in one save, draft reconciliation keeps unsaved items); company isolation (other company's period), body company ignored, rollback on refused Master Register write, reader denied with no events.

## Not done / for the coordinator to verify visually

- Visual check of the six sections, the Operating scope card, the save bar with the change/correction choice and the failure list.
- No atomic multi-item save (by design of the canonical domain).
