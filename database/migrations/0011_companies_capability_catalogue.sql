-- TES Companies capability catalogue
-- Migration: 0011
--
-- Scope:
--   - seed exactly six Companies / Organization / Customer capabilities into
--     public.capabilities (catalogue entries only)
--
-- Contract:
--   - This migration only describes WHAT can be authorized. It grants nothing:
--     no relationships, no assignments, and no relationship_capability_grants
--     are created, so no ordinary actor gains any access from this migration.
--     Master Account behavior is unchanged (it is authorized before ordinary
--     relationship/grant evaluation).
--   - The capabilities table has no scope column. The intended scope of each
--     capability is therefore documented in its description and MUST be enforced
--     by the server, which requests the stated scope when it authorizes:
--       * SYSTEM only   - authorized with scope {type: SYSTEM}
--       * CUSTOMER only - authorized through an already-authorized Customer
--     A SYSTEM-only capability must only ever be granted on a SYSTEM assignment.
--   - A canonical Organization is global. Global Organization identity is not
--     global tenant visibility: ORGANIZATION_READ never authorizes directory
--     listing or search; only ORGANIZATION_REGISTRY_READ (SYSTEM) does.
--   - A Customer is TES's relationship with an Organization. CUSTOMER_ESTABLISH
--     establishes that relationship; it does not create a real-world entity. A
--     combined "create an Organization and make it a Customer" workflow requires
--     both ORGANIZATION_CREATE and CUSTOMER_ESTABLISH.
--   - There is deliberately NO Organization delete capability: TES archives and
--     preserves history.
--
-- This migration intentionally does NOT:
--   - change any schema, privilege, constraint, index, function or trigger
--   - add a capability scope column or any SYSTEM-assignment constraint
--   - create grants, relationships, assignments or actors
--   - seed capabilities for any other domain (Authorities, Tax, Customs,
--     Contacts, Vehicles, Drivers, Credentials, Citations, ...), merge,
--     classification-specific or Customer lifecycle capabilities
--   - seed CUSTOMER_CREATE or ORGANIZATION_DELETE
--
-- The runtime identity keeps its existing SELECT-only access to
-- public.capabilities (migration 0006); no privilege change is needed.

INSERT INTO public.capabilities (code, display_name, description, is_active, sort_order)
VALUES
    (
        'ORGANIZATION_READ',
        'Read Organization',
        'Read the canonical Organization behind an already-authorized Customer. Does not authorize Organization directory listing or search. Intended scope: CUSTOMER only.',
        true,
        10
    ),
    (
        'ORGANIZATION_REGISTRY_READ',
        'Read Organization Registry',
        'SYSTEM-wide Organization registry access: list and search Organizations, read any Organization, view duplicate-match details, and list Customers. Intended scope: SYSTEM only.',
        true,
        20
    ),
    (
        'ORGANIZATION_CREATE',
        'Create Organization',
        'Create a canonical Organization. Does not establish a TES Customer relationship. Intended scope: SYSTEM only.',
        true,
        30
    ),
    (
        'ORGANIZATION_UPDATE',
        'Update Organization',
        'Modify canonical Organization facts: names, aliases, appropriate identifiers, registration jurisdiction and organization classifications. Does not authorize independent domains such as Authorities, Tax, Customs, Vehicles, Drivers, Contacts or Credentials. Intended scope: SYSTEM only.',
        true,
        40
    ),
    (
        'ORGANIZATION_ARCHIVE',
        'Archive Organization',
        'Archive or restore a canonical Organization while preserving history. There is no Organization delete capability. Intended scope: SYSTEM only.',
        true,
        50
    ),
    (
        'CUSTOMER_ESTABLISH',
        'Establish Customer',
        'Establish the TES Customer relationship for an existing canonical Organization and begin the Customer engagement. A combined create-and-establish workflow also requires ORGANIZATION_CREATE. Intended scope: SYSTEM only.',
        true,
        60
    );
