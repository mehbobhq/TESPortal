# Contracts foundation (migration 0031)

Builds on the 0030 contract shell (`customer_contracts`, `customer_contract_line_items`, `customer_authority_assignments`,
`evidence_documents`). Everything here is additive: no existing table, column, constraint, policy, grant or migration changes,
and no existing row is rewritten. 0030 gains **guard triggers only** (they act on new writes).

## Contract scope

service scope + responsibility matrix + pricing/package + authority/signatory + evidence rules + Master Register accountability.

Out of scope: invoices, payments, billing, tax calculation, external e-signature. Fees are agreed *terms* (`fee_minor_units`),
never billing records, and are never copied into the Master Register.

## Business rules and where each is enforced

| Rule | Enforcement |
| --- | --- |
| 1-4. Exactly one active Service Decision Authority and Contract Signatory per customer; same or different person; never two active holders | 0030 partial unique index `customer_authority_assignments_one_active_uq`; 0031 insert/update guards |
| 5. Operational contacts cannot decide scope | `guard_contract_decision_row`: matrix and pricing rows can only be written under the contract's **active Service Decision Authority** assignment |
| 6. Replacement needs verified written company notice, revokes the old authority, preserves history | `customer_authority_change_events` ledger + deferred constraint trigger `customer_authority_assignments_change_recorded`; ended assignments are frozen; the notice must be a verified, unexpired `CUSTOMER_AUTHORITY_NOTICE` of the same organization |
| 7. TES responsibility starts at the agreed effective date | `customer_contract_responsibility_matrix.effective_responsibility_date` is mandatory and may not precede the date TES assumed responsibility for the scope |
| 8. No assumption of pre-engagement history without evidence | `history_treatment` defaults to `excluded`; `tes_assumes_with_evidence` needs a start date before the effective date **and** verified evidence (CHECK + guard) |
| 9. Evidence for every contract-significant status/authority change | `customer_contract_status_events` (CHECK: evidence required for every transition) and `customer_authority_change_events` (notice NOT NULL) |
| 10. Master Register accountability | both ledgers, pricing and matrix rows carry a NOT NULL foreign key to `master_register_events`; the service writes the event in the same transaction as the change; reading the workspace records `RECORD_VIEWED` |

## Readiness

`tes_security.contract_gate_failures(contract_id, target_status)` is the single source of truth, used by both the application and
the contract status trigger. Gates: customer relationship, contract reference, service scope, responsibility matrix, required
settings, pricing/package, Service Decision Authority, Contract Signatory, evidence requirements (rule catalogue
`contract_evidence_rules`), and the Master Register accountability path.

Lifecycle: `draft → ready_for_signature → signed → superseded | archived` (`ready_for_signature → draft` when something material
changes, e.g. an authority replacement). `customer_contracts_guard_update` refuses any status change without a ledger row (with
verified evidence and a Master Register event) written in the same transaction, and refuses `ready_for_signature` / `signed`
while any gate fails. `signed` additionally needs a `SIGNED_CONTRACT_DOCUMENT` as the change evidence.

## Layering

```
UI (app/companies/[id]/onboarding/contracts-panel.tsx)
 -> API (app/api/companies/[id]/contracts)      GET workspace, PATCH one action
  -> lib/contracts/service.ts                   server-only; withAuthorizedSystem(CONTRACT_READ | CONTRACT_MANAGE)
   -> lib/contracts/operations.ts               validation, rules, Master Register events (same transaction)
    -> PostgreSQL (migration 0031)              final arbiter
```

Evidence documents stay GCS-backed metadata in `evidence_documents`; contract tables only reference them by id.
No browser storage is used anywhere in the path.

## Production

`scripts/database/verify-production-contracts-foundation.sh` is read-only: `TES_VERIFY_PHASE=pre` proves production is at 0030
with no 0031 object; `post` proves ledger checksums, tables, RLS, policies, grants, constraints, indexes, triggers and the
SECURITY DEFINER allow-list. Run it through the *Production Contracts Foundation Verification* workflow, then apply the
migration with the guarded production migration workflow, then verify `post`.
