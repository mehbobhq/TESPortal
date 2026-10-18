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

## A2. Fields given a canonical owner by migration 0033 (Company and Customer profile facts)

| Form field | Domain / table | Applies to | Capability (write) | Edit semantics |
| --- | --- | --- | --- | --- |
| website | `organization_channels` channel type WEBSITE, usage GENERAL (server vocabulary, no migration; rule `website.http_https_permissive.v1`) | every company type | CONTACT_MANAGE | add / change / correct / end(clear) / void |
| cargoTypes | `company_cargo_category_periods` + controlled `cargo_categories` (6 descriptive categories) | Customer | COMPANY_PROFILE_MANAGE | set semantics: removed = ended (change) or voided (correct); at least one required |
| gpsProvider, fuelProvider | `company_fleet_provider_periods` (kind GPS / FUEL; name only; one current per kind) | Customer | COMPANY_PROFILE_MANAGE | add / change / correct / clear (end or void) |
| payMethod | `customer_billing_preference_periods` + controlled `billing_payment_methods` | Customer | CUSTOMER_RELATIONSHIP_MANAGE | add / change / correct / clear |

All four are effective-dated with correction history (`corrected` links to its replacement and inherits its business time; `voided` is an entry made
in error; nothing is deleted), written through `lib/company-profile/facts.ts` with a Master Register event per row, in the same transaction. Provider
names are free text and are never placed in an event. Cargo categories are descriptive: they never assert that a regulation applies (rule
applicability, 0019, is separate). The billing preference is explicitly not contractual payment terms and not a payment transaction.

An edit sends a fact only when it changed (absent = untouched; empty = an explicit clear). An unchanged value writes nothing.

## A3. Fields shown read-only because another workflow owns the value

| Form field | Derived from | Never set by |
| --- | --- | --- |
| svcType (Service Type) | the package on a **signed** contract line (`customer_contracts` / `customer_contract_line_pricing`); "Not contracted" when no signed contract exists; "Not permitted to view" without CONTRACT_READ | a profile create or edit (refused with the reason) |
| status (Service Status) | the engagement stage (`customer_engagement_stages`); a new Customer is always ONBOARDING | a profile create or edit |
| endDate | `customer_engagements.ended_at`, set only by the Edit page's "End this customer's service" (reason required) | the create form |
| assessmentDate | the latest `onboarding_readiness_snapshots.computed_at`; no date when none exists; withheld without EVIDENCE_READ | typing |
| startDate | `customer_engagements.started_at`: required at creation, fixed afterwards. A verified correction (reason + immutable history) needs a start-correction ledger that does not exist (only terminations have one) and is a separate approved change | the Edit page |

## B. Fields investigated and still **not** supportable

| Field | Finding | Evidence | Decision / change needed |
| --- | --- | --- | --- |
| gstHst (CRA RT account / US State Tax Registration #) | **No valid registration owner.** `registration_programs` (0016) has no GST/HST program and no sales-tax family, and lists what is deliberately not a program; the US half has no program at all | `database/migrations/0016_tax_registration_foundation.sql` | A new program (and family) by migration plus a decision on namespace and normalization. It is not stored in another field and is not a compliance claim |

## C. Fields that exist only to support the above

`mvidKind`, `mvidRegion`, `nscKind`, `nscRegion`, `irpBase`, `iftaBase`: the canonical domains require the number type and issuing
jurisdiction; they are explicit inputs, never guessed. `contactGivenName`/`contactFamilyName`: the confirmed split of the original
full-name field.
