# UI recovery release readiness

**Status: not ready to merge or deploy.** Nothing was merged or deployed.

Ready: domain behavior, authorization, isolation, history and Master Register semantics of the restored workspaces (full DB suite, zero new failures versus main), type baseline, build, static boundaries.

Blocking before release:
1. Browser verification and screenshots of every restored workspace on a disposable database (not yet done; see verification report).
2. Human review of decisions that needed judgement, listed per workspace in `matrix/*.md`, in particular: insurance archive reason stored in the existing event `outcome.reason` and new `organizationId` scope guards in `lib/insurance/operations.ts`; new Business identifier operations (`lib/corporate-identity/business-identifiers.ts`) over `organization_identifiers`; new vehicle and driver operations (no migration); removal of the `sandbox` attribute on the annual-returns PDF preview iframe; registration-type and vehicle-type mappings; Settings save is per-item not atomic.
3. Existing blockers unchanged: ten company fields without an owner, citations domain, evidence links, filing/obligation domain, legacy-data import, inherited failures on main (40 DB, 3 static).
4. No production migration, IAM, GCS, RLS or grant change is part of this branch; none is needed for it.
