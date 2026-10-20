# Contacts corrections, restricted identity details and operational-email exclusions

## Migration 0035 (`0035_person_identity_details_and_operational_email_exclusions.sql`)
Forward-only, additive; 0001-0034 untouched. Requires the Production ledger to be exactly 0001-0034. **Not applied to Production by this change.**

| Object | Purpose |
|---|---|
| capabilities `PERSON_IDENTITY_READ`, `PERSON_IDENTITY_MANAGE` | restrict date of birth and the licence record; neither is implied by `CONTACT_MANAGE` / `PERSON_REGISTRY_READ` |
| `person_birth_dates` | restricted date of birth keyed by the one canonical Person; corrected / voided, never deleted; SYSTEM-only RLS |
| `organization_person_operational_email_exclusions` | audited, effective-dated "do not copy this contact on OPERATIONAL email"; separate from the person, their email, the relationship and the PRIMARY designation |
| unique index `evidence_documents(id, organization_id)` | lets exclusion evidence be tied to the same company by foreign key (additive; the pair is already unique because `id` is) |

RLS: +2 tables, +2 policies (CI catalogue counts 82 / 163, ledger 35). The runtime role gets no DELETE / TRUNCATE and may not rewrite content.
Rollback of the migration: nothing existing is altered, so dropping the two tables, the unique index, the four functions and the two capability rows reverses it (only when empty).

### Application rollback compatibility (corrected after the 0034 incident)
The PR #29 build (and anything built from it before the compatibility fix) reads `organization_person_operational_email_exclusions` unconditionally, so **it is NOT a safe rollback target on a database at 0034**: it reproduces the Company Profile / Contacts outage. Choose the rollback by the actual schema (check the ledger first):

| Database state | Safe application builds | Unsafe |
|---|---|---|
| Ledger at 0034 | the build before PR #29 (`c109c0a`, PR #28), or any build containing the schema-compatibility fix | the PR #29 build |
| Ledger at 0035 | the build before PR #29 (it never touches the 0035 objects) or any build containing the compatibility fix or PR #29 | none known |
| Partly applied 0035 | a build containing the compatibility fix (it fails closed and keeps ordinary reads); repair 0035 before using its features | the PR #29 build |

Do not drop the 0035 objects to make an older build work: they are not needed by builds before PR #29, and dropping populated tables would lose recorded data.
After applying: grant `PERSON_IDENTITY_READ` / `PERSON_IDENTITY_MANAGE` to the staff who may handle identity details (nobody has them by default except the Master Account).

## Behaviour
- **Atomic contact save**: `saveContact` / `createContactFull` are one request and one transaction; the server compares with the stored record and applies only the differences, so a refused save changes nothing and a repeated save is a no-op (the earlier chain of per-field requests could persist a change and still report failure).
- **Identity details**: date of birth in `person_birth_dates`; licence number, jurisdiction, expiry and class reuse the canonical `driver_licences` (a licence number held by another person is refused without disclosing who; recording a licence does not make a contact a company Driver). Restrictions is not part of this workflow. Entering details never verifies an identity. Neither value is ever copied into the Master Register.
- **Designation**: Primary Contact is only its own checkbox/designation; "Primary Contact" and "Driver" are refused as job titles.
- **Operational email**: exclusion records source, reference, optional same-company evidence and the actor (Master Register); the resolver reports `PRIMARY_CONTACT_EXCLUDED`. It is a resolver only: no outbound email integration is connected, so nothing proves delivery or acknowledgement.
- **History**: Contacts shows one entry per business operation (for example one "Contact Created"); the Master Register keeps every technical event and the page links to it.
