# Evidence reconciliation implementation preflight

Status: inspected repository migration definitions; NO migration applied and NO runtime code implemented.

## Existing schema that must be reused
- 0016_tax_registration_foundation.sql: public.registrations stable ID; public.registration_versions effective-dated account number, jurisdiction, correction state and lookup index. Do not create a duplicate IFTA account registry. Registration is separate from quarterly returns.
- 0030_onboarding_evidence_contracts_foundation.sql: public.evidence_documents and public.evidence_links for reusable document-to-record links. Do not create another document table.
- 0032_evidence_payload_lifecycle.sql: GCS-backed payload metadata and lifecycle. Do not bypass quarantine, hash verification, or view logging.

## Missing capabilities to assess before coding
- A canonical portal communication / email / note source record with immutable content or immutable source reference, provenance, and author/received time; evidence_links currently refers to documents and is not proof that all message types can be linked.
- A reusable evidence-source-to-Record-ID association for non-document communications, without copying the source or duplicating it.
- A contradiction-review state for multiple assertions about the same external identifier, including jurisdiction and effective period.
- A correction workflow requiring a source link or attributable note, with a reviewable impact preview, clear distinction between client-declared and authority-verified, and atomic database changes.
- A searchable registration-number endpoint including historical numbers, scoped by tenant authorization and appropriately labelled.
- Integration with Master Register, historical filings, and current company views.

## Next implementation gates
1. Verify the production migration ledger read-only, especially edited-in-place migrations, before considering any new migration.
2. Inspect all relevant tables, policies, triggers, and services in 0016, 0030, 0032 and the authorization and Master Register foundations.
3. Confirm whether an existing communication/ticket/note schema already solves non-document sources.
4. Design the smallest additive migration only for demonstrated missing functionality. No change to old migration checksums.
5. Implement services with explicit authorization and atomic updates; test in disposable PostgreSQL 17, including duplicate-source reuse, contradictory instructions, record linkage, number search and historical preservation.
6. No deployment, production migration, or main merge without separate approval.
