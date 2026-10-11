# Companies foundation: domain boundaries, legacy continuity and the 0020 decision

Migrations 0016-0019 complete the canonical PostgreSQL foundation of the Companies domain. This document records what each
domain owns, what it deliberately does not, how the legacy browser (localStorage) data relates to it, and why no migration
0020 exists.

## Dependency map

```
Organization (0003)
 |-- Locations (0012)                 where
 |-- Operating Authorities (0013)     USDOT, MC, MVID, RIN, CVOR, NSC, IRP (IRP is canonical here, never duplicated)
 |-- Contacts / People (0014)         who
 |-- Customer Relationship (0015)     TES engagement, scope, responsibility, agreements
 |-- Tax / Registration (0016)        IFTA, state highway-use / weight-distance / excise accounts, SCAC, CA carrier code
 |-- Insurance (0017)                 policies, terms, coverages, endorsements, workers' compensation accounts, bonds, broker of record
 |-- Credentials (0018)               systems registry, accounts, status, verification, secret SLOTS (never secrets)
 `-- Operating Profile (0019)         operating scope, rule applicability, driver minimums
Later domains that will REFERENCE these ids (nothing is built for them here):
 Tax Filing -> registrations.id; Vehicles -> insurance_coverages.id (scheduled vehicles), registrations.id (decals/permits);
 Drivers; Evidence/GCS -> insurance_policy_terms.id, registration_versions.id; Rules / BI / DS read these facts.
```

## What each migration owns

| Migration | Owns | Explicitly does not own |
|---|---|---|
| 0016 | registration identity, number/jurisdiction/licence-period versions, registration status history, program catalogue | filing obligations, returns, payments, decals, portal logins, evidence; IRP/USDOT/MC (0013); Form 2290 (EIN); C-TPAT/PIP/CSA/FAST/SmartWay/COR/PIC (Programs domain) |
| 0017 | policy identity, terms, coverages (limit/deductible/currency), endorsements, broker-of-record history, cancellation | certificates / COI groups, evidence, regulatory filings (BMC-91 etc.), scheduled vehicles, sufficiency verdicts, stored status |
| 0018 | canonical system registry (+aliases), company credential identity, status and verification history, secret-slot state and opaque secret-store reference | any secret value, any reveal path, team ownership (Teams/RBAC), customer access |
| 0019 | operating-scope, rule-applicability and driver-minimum facts, each effective-dated with correction history; the 45-rule catalogue | UI/user preferences, derived Rules configuration, generic key/value settings, anything owned by another domain |

## Cross-domain rules enforced in the database

* `tes_security.guard_active_organization` (0016): a row may reference an Organization only while it is `active` (locks it
  `FOR SHARE`). Used by every table that names an Organization in 0016-0019.
* `company_profile_rules.registration_program_code` -> `registration_programs.code`: applicability rules and registrations
  share one program vocabulary without duplicating either.
* `insurance_broker_periods` -> `organization_person_relationships`: a broker contact is a canonical Contacts relationship
  with the brokerage Organization, never a copy.
* Insurer / broker / provider are canonical Organizations; nothing is invented to satisfy a required field.

## Legacy / browser data

Today the Tax Filing, Insurance, Credentials and Settings workspaces keep their state in browser `localStorage`
(`tes_company_tax_filing_*`, `tes_company_insurance_*`, `tes_company_credentials_*` + `tes_portal_registry_v1`,
`tes_company_compliance_settings_*`, with companies in `tes_companies`). Nothing is migrated by 0016-0019 and the browser data
is not discarded. After these migrations PostgreSQL is the canonical home; browser data becomes a migration SOURCE only.

Continuity strategy (no schema change needed):

1. Each domain ships a pure `legacy.ts` that maps the legacy vocabulary to canonical codes and returns an explicit
   `UNMAPPABLE` / `NO_ASSERTION` / `SECRET_NOT_MIGRATED` result instead of guessing.
2. A later import tool reads one company's browser export, resolves the company through the 0010 legacy-identity continuity
   (`CMP-*` -> Organization), derives deterministic UUIDs (UUIDv5 over `legacy-record-id`) so a re-run is idempotent and a
   reconciliation report can diff source vs PostgreSQL, and writes through the SAME services (so authorization, history and
   Master Register events apply).
3. Rollback is "archive/void the imported records" (nothing is ever deleted); reconciliation proves counts and keys.
4. Legacy passwords and security answers are never migrated (they were never persisted by the application).

The import is only run when mapping, reconciliation and rollback are all in place; it is intentionally out of scope here.

## Evidence boundary

PostgreSQL owns the structured facts; GCS owns documents. No table here stores file content, URLs or OCR output. Stable ids
(`insurance_policy_terms.id`, `registration_versions.id`) are the attachment points for later evidence records. A fact with
no evidence is simply a fact with no evidence link; nothing marks it "evidenced".

## Why there is no migration 0020

0020 was reserved for cross-domain integrity gaps that cannot belong to 0016-0019 individually. The audit found none:

* Organization lifecycle protection is a DB backstop inside each new domain via the shared `guard_active_organization`.
* Cross-domain links that exist (rule -> program, broker -> Contacts relationship, credential system -> provider Organization)
  are ordinary foreign keys inside the later migration that needs them.
* No capability changes are needed beyond the eight catalogue rows already added with their domains.
* Legacy continuity needs no schema (above).
* Retro-fitting triggers onto closed tables (0012-0015) would modify closed domains for speculative benefit.

**0020 NOT REQUIRED - Companies Foundation closed at 0019.**
