# TES evidence-linked record corrections

Status: approved product rules; engineering implementation pending.
Scope: IFTA, IRP, tax registrations, authorities, insurance, vehicles, drivers, and other evidence-backed records.

## Permanent identity and relationships
Every record has a permanent internal Record ID, including company and registration records. Child records reference the appropriate parent Record ID. External account numbers are searchable attributes, never primary keys or the sole linkage. Historical account numbers remain searchable with current/historical labels and company-scoped permissions. Preserve assignments after closure; verify any apparent number reuse against the issuing authority and jurisdiction rather than assuming a universal legal uniqueness rule.

## Evidence selection
When correcting an account number or another evidence-backed attribute, show:
- Link existing portal communication, note, document, or other preserved evidence.
- Attach a new email/PDF/document only if an existing original is unavailable.
- Create a dated, attributable note describing client communication if the original cannot be preserved.

Existing evidence is reused by reference. Never require duplicate uploads for the same communication. A single source may link to multiple Record IDs; links are explicit and navigable. Preserve original source content, provenance, received timestamp, supplier, and evidence hash where applicable.

## Client instructions and contradictions
An attributable client instruction is sufficient operational evidence when an official document is unavailable, except where an applicable process specifically requires official verification. Label the value client-declared; do not misrepresent it as authority-verified.

The first valid applicable client communication is sufficient if no contradictory information is present in available linked communications and documents. Later identical communications do not need to be uploaded or linked redundantly. Supplementary non-conflicting details are not contradictions. A different number, jurisdiction, effective period, or status can be a contradiction. An explicit correction or revocation supersedes the earlier instruction for the applicable period but does not erase it.

Before accepting or changing a value, check available relevant evidence and identify contradictory claims. Flag unresolved conflicts for review, preserve all materially conflicting evidence, and prohibit silent overwrite. Do not promise perfect detection of unknown or unreceived communications.

## Correction transaction and impact
Require source evidence link and correction reason. Show an impact preview of affected quarters, filings, payments, reminders, reports and downstream views. Preserve filed returns and original evidence as-of their actual submission. Propagate applicable current values via canonical record relationships, not duplicated writable fields. Corrections must be atomic for the logical operation, authorization-scoped, and append-only Master Register logged with actor, time, old/new values, source link, and impacted Record IDs. Preserve direct navigation between evidence, correction, record and dependent records. Never merge distinct registrations solely because an account number matches.

## Verification gates
Tests: existing-evidence reuse, first consistent communication, supplemental information, contradictory later message, explicit correction, client-declared versus authority-verified, missing source rejection, current and historical number search, as-of filing preservation, dependency impact, rollback, and cross-tenant access denial.

No schema migration, production deployment, or claim of implementation is authorized by this document.
