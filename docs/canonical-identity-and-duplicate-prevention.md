# Canonical identity and duplicate prevention

Status: written with migrations 0037 and 0038. This page records which natural key decides each record, where it is enforced, and the identity
contract for the domains that have no canonical PostgreSQL model yet.

## Principles

1. **A natural key decides, a name never does.** Regulatory identifiers, VINs, plates, licence numbers and policy numbers are keys. A matching
   name, date of birth, e-mail address or file hash is a *candidate* for human review, never a decision.
2. **The database is the authority.** Where a reliable natural key exists it is a unique index or constraint, so no writer (including one that
   skips the service) can bypass it. Services check first only to give a clean answer and to take the right lock.
3. **Normalize once, in the same way in SQL and TypeScript.** Jurisdictions use `tes_security.canonical_country_code` / `canonical_region_code`
   (migration 0037) and `lib/operational-identity/jurisdiction.ts`, generated from one mapping. A key is always scoped by its own namespace
   (program, kind, identifier type) and jurisdiction: the same number in another program or jurisdiction is a different record.
4. **Never merge, reassign, overwrite or delete silently.** A conflict is refused with a safe 409. Ending a relationship, correcting a record and
   merging identities are explicit, accountable acts (Master Register), and history rows are kept.
5. **Conflict responses never disclose another company.** The holder is named only to a caller who may read the registry
   (`ORGANIZATION_REGISTRY_READ`); everyone else gets a fixed message.

## Matrix (see the delivery report for tests)

| Domain | Natural key / rule | Enforced by |
|---|---|---|
| Company identifiers (incorporation, CRA BN, IRS EIN, extra-provincial) | namespace + type + jurisdiction + value | `organization_identifiers_active_identity_uq` and (0038) `..._canonical_identity_uq`; server normalization and collision handling in `lib/corporate-identity` |
| Tax / programme registrations (GST/HST, IFTA, IRP, ...) | programme + jurisdiction + number | `registration_versions_current_number_uq` and (0038) `..._canonical_number_uq`; CHECKs on the stored form; programme rules |
| Operating authorities (USDOT, MC, CVOR, MVID, ...) | kind + jurisdiction + number | `operating_authority_versions_current_number_uq` and (0038) `..._canonical_number_uq` |
| Company name | not a key | advisory `SAME_LEGAL_NAME` candidate at creation (registry readers only) |
| People | no natural key; explicit reuse | `findPersonMatches` (advisory), `addRelationship` (explicit reuse), driver licence key |
| Drivers | one open assignment per person; licence number per canonical jurisdiction | 0037 |
| Vehicles | VIN (current); plate per canonical jurisdiction; one current owner and one current operator | `vehicles_vin_current_uq`, `vehicle_registration_current_canonical_plate_uq`, (0038) `organization_vehicle_open_owner_uq` / `..._operator_uq`; vehicle row lock |
| Insurance | insurer + family + policy number (a policy keeps its number across terms) | `insurance_policy_terms_number_namespace` (0017) |
| Credentials | company + system + username | `company_credentials_active_account_uq` |
| Evidence | document identity = company-owned record; storage object identity = bucket + object + generation | `evidence_documents_gcs_object_uq`, `evidence_documents_id_organization_uq`; file hashes are deliberately **not** keys |

## Evidence

A file hash proves bytes, not a legal record: the same PDF can legitimately support two different facts, or be uploaded by two companies. So
there is no unique key on a hash, a document belongs to exactly one company (composite key `(id, organization_id)`), and one stored document
may be referenced from many records (`evidence_links`, identity verification events). A *duplicate upload warning* may use a hash as a hint to a
person; it must never reuse, reject or merge on its own.

## Identity contract for event domains (no canonical model yet)

Roadside inspections, citations, repairs and training are still browser-local prototypes (`lib/performance-*`, `lib/auto-save-roadside.ts`).
Do not import that data and do not create speculative tables. When their canonical models are built (follow the append-only, versioned
patterns of migrations 0013 and 0017), each must satisfy this contract:

* **One authoritative row per real-world event.** Derived views (performance scores, dashboards, summaries) read it; they never store a competing
  copy of the event.
* **Inspection:** key = issuing jurisdiction (canonical) + report number (normalized) [+ inspection date]. Carrier, driver (person) and vehicle(s)
  are references, not part of the key. Violations are child rows keyed by (inspection, violation code, sequence).
* **Citation:** key = issuing authority/jurisdiction + citation number (normalized) + issue date. It may reference the inspection it came from.
  Court outcomes are new versions, not edits.
* **Corrective action / repair:** key = company + internal work-order number, and (vendor, invoice number) for vendor documents. It carries a direct
  reference to the originating event (inspection violation or citation) where there is one, so the corrective action and its cause stay linked.
* **Training:** key = person + programme/course code + completion date, with the provider's certificate number as a secondary key scoped by
  provider.
* **Documents** attach through `evidence_links`; the same document may support the event and its corrective action.
* **Ambiguous matches** open an entity-resolution case; they are never merged automatically.

## Lifecycle: retention, legal hold, secure deletion

Nothing in 0037 or 0038 deletes anything. The design intentionally has these properties, which a future retention design must accommodate:

* Append-only history (driver identity verification events, status periods, Master Register) and `ON DELETE RESTRICT` references mean a person,
  a company or an evidence document that is referenced cannot be removed by a plain delete.
* Evidence is never deleted by the application (`docs/evidence-payload-lifecycle.md`); the storage buckets own retention and lifecycle.
* A lawful erasure or retention-expiry request for a driver's identity evidence therefore needs an explicit mechanism that does **not** exist yet:
  redaction in place (keep the row and its key, remove the payload and personal fields), a legal-hold flag that suspends expiry, and a documented
  approval path. Until then the system retains, and the conflict is reported rather than worked around.
* Driver data is personal and sensitive: verification rows hold references and a coded method only; free text is limited to a bounded
  revocation reason; Master Register events carry references, never personal values.
