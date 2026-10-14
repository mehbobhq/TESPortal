# Canonical field ownership (company creation and editing)

Source of truth in code: `lib/company-directory/creation-input.ts` (`FIELD_OWNERS`, `UNSUPPORTED_FIELDS`), `create-company.ts`,
`update-company.ts`, `read-profile.ts`. Every write goes through the domain's own operations (own validation, own Master Register event) in
one transaction; capabilities are pre-checked and re-proven by row-level security for each domain (see docs/company-recovery.md).

## A. Fields with an approved canonical owner (persisted and read back)

| Form field | Domain / table | Validation | Capability | Edit | Read-back |
| --- | --- | --- | --- | --- | --- |
| companyName | corporate-identity `organizations.legal_name` / `display_name` | required | ORGANIZATION_CREATE (create), ORGANIZATION_UPDATE (edit) | Edit page | profile name |
| dba | `organization_aliases` TRADE_NAME | alias rules | same | Edit page | profile DBA |
| companyType | `organization_classifications` (primary); Customer also `customers` + `customer_engagements` | closed list | ORGANIZATION_CREATE; CUSTOMER_ESTABLISH for Customer | not editable | profile record type |
| regCorpCountry / regCorpState | `organizations.country_code` / `region_code` | known province/state, country must agree | ORGANIZATION_CREATE | not editable | "Registered in" |
| incorpNo | `organization_identifiers` INCORPORATION | needs a formation jurisdiction; never guessed | ORGANIZATION_CREATE / UPDATE | Edit page (correct/supersede) | Business card |
| businessNo | `organization_identifiers` CRA_BN | 9-digit root; **never derived from an EIN** | same | Edit page | profile |
| ein | `organization_identifiers` IRS_EIN | 9 digits; **never derived from a BN** | same | Edit page | profile |
| opRegion | `company_operating_scope_periods` | closed list | COMPANY_PROFILE_MANAGE | Edit page / Settings (change vs correct) | profile, Settings |
| startDate (Customer) | `customer_engagements.started_at`, stage ONBOARDING | required for a Customer, refused otherwise | CUSTOMER_ESTABLISH | lifecycle | profile |
| ending service (was "End Date") | `customer_engagements.ended_at` + closed end-reason catalogue | reason required; after start; never reopened | CUSTOMER_RELATIONSHIP_MANAGE | **Edit page "End this customer's service"** | profile stage |
| contactPerson → confirmed given/family name | `persons`, `person_name_versions`, `organization_person_relationships` (PRIMARY) | full name is never split silently; the user confirms the two inputs | CONTACT_MANAGE | Contacts workspace | profile "Primary contact" |
| phone, email, billingEmail | `organization_channels` (GENERAL / GENERAL / ACCOUNTING) | channel normalisation | CONTACT_MANAGE | Contacts workspace | profile |
| reg_*, mail_* (Customer), yard_* (Customer) | `locations` + `organization_location_assignments` REGISTERED / MAILING / HOME_YARD, independent | all-or-nothing block; country must match province/state | ORGANIZATION_UPDATE | Edit page (change = history kept, correct = flagged) | profile address cards |
| usdot, mc, mvid(+kind/region), nsc(+kind/region), accIrp(+base) | `operating_authorities` | explicit kind and issuing region; number namespace collisions refused | ORGANIZATION_UPDATE | Authorities workspace (change/correct) | profile, Authorities |
| accIfta(+base), accNyhut, accNm, accKyu, accOr, accCt, scac, carrierCode | `registrations` (tax programs) | program normalisation rules | TAX_REGISTRATION_MANAGE | Tax Filing workspace (change/correct) | profile, Tax Filing |

## B. Fields investigated for a canonical owner and **not** supportable today

Each was checked against the approved foundations (migrations incl. header comments, docs, definitions, tests). Class: A = already supported,
B = supportable by an existing domain without schema or semantic change, C = needs a new approved model or migration (or an explicit
decision). None is class A. The field and its original definition stay on the form and profile, disabled/"Not recorded", and the server
refuses them if sent.

| Field | Finding | Evidence | Decision / change needed |
| --- | --- | --- | --- |
| website | **C-lite**: no migration (channel type is server policy) but a vocabulary change and a decision | `lib/contacts/definitions.ts` `CHANNEL_TYPES = [EMAIL, PHONE]`; 0014 shape CHECK only | Decide: a website is an organization channel with usage GENERAL? URL normalisation rule? Do not reuse `credential_systems.login_url` |
| gstHst (CRA RT account) | **C**: migration | `identifier-definitions.ts`: a program account is NOT a BN root; `registration_programs` has no GST_HST; family CHECK has no sales-tax family | New program (+ possibly family) by migration and decision on namespace. The US "State Tax Registration #" half has no owner at all. **Never** map into CRA_BN / IRS_EIN |
| svcType (Premium/Standard/Basic) | **C** | 0015: `service_catalogue` "deliberately unseeded"; product levels are COMPLIANCE/BUSINESS_INTELLIGENCE/DECISION_SUPPORT, not tiers | Business decision on what the tiers mean; then catalogue seed/model |
| status (Active/Pending/Inactive) | **B only with an approved mapping; otherwise decision** | `establishCustomerRelationship` accepts a stage; "Active" would skip the onboarding readiness/contract gates; "Inactive" has no clean stage | New customers start in ONBOARDING. Only Pending→ONBOARDING is non-controversial, but it is still an assumption, so it is **not** applied |
| endDate | **B, post-creation only** (implemented on Edit) | `endEngagement` needs a reason from a closed catalogue and an open engagement; an engagement cannot be created ended | Done via "End this customer's service" with a reason |
| payMethod | **C / excluded** | 0015 agreements section: "No document binaries, credentials, payment details, prices or invoicing"; contracts-foundation: payments out of scope | Needs an explicit decision and a new model; a method *name* is arguably not "payment details" |
| assessmentDate | **C** | no assessment model exists (only `master-register/assessment.ts` context type) | Decide what "assessment" is |
| cargoTypes / cargoInfo | **C** | company-profile rules are jurisdiction-specific regulations (DG_CANADA, DG_US, …); asserting applicability from a cargo checklist is a compliance claim, not a description of freight; most categories map to no rule | New effective-dated cargo-profile model + decision. **The original mandatory-cargo rule for Customers cannot be enforced**: it stays in code behind `CARGO_STORAGE_AVAILABLE = false` (an architectural conflict, reported, not silently dropped) |
| gpsProvider, fuelProvider | **C** | credentials categories FLEET/FUEL exist, but a credential needs a username and asserts an account; free-text provider names cannot be stored in the controlled system registry | Decide: a "provider used" model (organization → credential system, no username) |

## C. Fields that exist only to support the above

`mvidKind`, `mvidRegion`, `nscKind`, `nscRegion`, `irpBase`, `iftaBase`: the canonical domains require the number type and issuing
jurisdiction; they are explicit inputs, never guessed. `contactGivenName`/`contactFamilyName`: the confirmed split of the original
full-name field.
